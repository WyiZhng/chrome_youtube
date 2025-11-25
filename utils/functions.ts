import { sendToBackground } from "@plasmohq/messaging"

/**
 * Comparison function used to sort tracks by priority
 */
function compareTracks(track1, track2) {
  const langCode1 = track1.languageCode
  const langCode2 = track2.languageCode

  if (langCode1 === "en" && langCode2 !== "en") {
    return -1 // English comes first
  } else if (langCode1 !== "en" && langCode2 === "en") {
    return 1 // English comes first
  } else if (track1.kind !== "asr" && track2.kind === "asr") {
    return -1 // Non-ASR comes first
  } else if (track1.kind === "asr" && track2.kind !== "asr") {
    return 1 // Non-ASR comes first
  }

  return 0 // Preserve order if both have same priority
}

/**
 * Strategy 0: Extract transcript from DOM (Most reliable method)
 * This method reads already-rendered transcript segments from the page
 * Inspired by: YouTube Transcript Copier extension
 */
async function extractTranscriptFromDOM(): Promise<any> {
  console.log("📄 Strategy 0: Attempting to extract transcript from DOM...")
  
  try {
    // First, try to find and click the transcript button to open the panel
    const transcriptSelectors = [
      "ytd-video-description-transcript-section-renderer button",
      "button[aria-label*='transcript' i]",
      "button[aria-label*='transcrição' i]",
      "button[aria-label*='transcripción' i]",
      "[aria-label*='Show transcript' i]"
    ]
    
    let transcriptButton = null
    for (const selector of transcriptSelectors) {
      transcriptButton = document.querySelector(selector)
      if (transcriptButton) {
        console.log(`✅ Found transcript button with selector: ${selector}`)
        break
      }
    }
    
    if (transcriptButton && !document.querySelector("ytd-transcript-segment-renderer")) {
      console.log("🖱️ Clicking transcript button to open panel...")
      ;(transcriptButton as HTMLElement).click()
      
      // Wait for transcript panel to load
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    
    // Now extract the transcript segments
    const segmentSelectors = [
      "ytd-transcript-segment-renderer",
      ".ytd-transcript-segment-renderer"
    ]
    
    let transcriptItems = []
    for (const selector of segmentSelectors) {
      transcriptItems = Array.from(document.querySelectorAll(selector))
      if (transcriptItems.length > 0) {
        console.log(`✅ Found ${transcriptItems.length} transcript segments`)
        break
      }
    }
    
    if (transcriptItems.length === 0) {
      console.warn("⚠️ No transcript segments found in DOM")
      return null
    }
    
    // Parse segments into our expected format
    const events = []
    let lastTimestamp = 0
    
    for (const segment of transcriptItems) {
      const textElement = segment.querySelector("[class*='segment-text']") || 
                         segment.querySelector("#content") ||
                         segment.querySelector("#text") ||
                         segment.querySelector("yt-formatted-string")
      
      const timestampElement = segment.querySelector("[class*='segment-timestamp']") ||
                              segment.querySelector("#timestamp") ||
                              segment.querySelector(".segment-timestamp")
      
      const text = textElement ? textElement.textContent.trim() : ''
      const timestampStr = timestampElement ? timestampElement.textContent.trim() : ''
      
      if (!text) continue
      
      // Parse timestamp (format: "0:00", "1:23", "1:23:45")
      let tStartMs = lastTimestamp
      if (timestampStr) {
        const parts = timestampStr.split(':').map(p => parseInt(p) || 0)
        if (parts.length === 2) {
          // MM:SS
          tStartMs = (parts[0] * 60 + parts[1]) * 1000
        } else if (parts.length === 3) {
          // HH:MM:SS
          tStartMs = ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000
        }
        lastTimestamp = tStartMs
      }
      
      events.push({
        tStartMs: tStartMs,
        dDurationMs: 3000, // Default duration
        segs: [{ utf8: text }]
      })
    }
    
    if (events.length > 0) {
      console.log(`✅ Successfully extracted ${events.length} transcript events from DOM`)
      return { events }
    }
    
    return null
  } catch (error) {
    console.warn("⚠️ DOM extraction failed:", error.message)
    return null
  }
}

/**
 * Inject script into page context to read ytInitialPlayerResponse AND fetch captions
 * This is necessary because content scripts run in an isolated environment
 * and cannot directly access page variables
 */
function injectPageScript(fetchCaptions = false, captionUrl = null): Promise<any> {
  return new Promise((resolve, reject) => {
    const messageId = `youtube-data-${Date.now()}`
    
    const messageHandler = (event: MessageEvent) => {
      if (event.source !== window) return
      if (event.data?.messageId === messageId) {
        window.removeEventListener("message", messageHandler)
        if (event.data.error) {
          reject(new Error(event.data.error))
        } else {
          resolve(event.data)
        }
      }
    }
    
    window.addEventListener("message", messageHandler)
    
    const script = document.createElement("script")
    script.textContent = `
      (function() {
        try {
          const playerResponse = window.ytInitialPlayerResponse;
          if (!playerResponse) {
            window.postMessage({
              messageId: "${messageId}",
              error: "ytInitialPlayerResponse not found"
            }, "*");
            return;
          }
          
          // If we need to fetch captions from page context (to use page's cookies/auth)
          if (${fetchCaptions} && "${captionUrl}") {
            fetch("${captionUrl}")
              .then(res => res.ok ? res.text() : Promise.reject('HTTP ' + res.status))
              .then(captionData => {
                window.postMessage({
                  messageId: "${messageId}",
                  playerResponse: playerResponse,
                  captionData: captionData
                }, "*");
              })
              .catch(err => {
                // Still send player response even if caption fetch fails
                window.postMessage({
                  messageId: "${messageId}",
                  playerResponse: playerResponse,
                  captionError: err.toString()
                }, "*");
              });
          } else {
            window.postMessage({
              messageId: "${messageId}",
              playerResponse: playerResponse
            }, "*");
          }
        } catch (e) {
          window.postMessage({
            messageId: "${messageId}",
            error: e.message
          }, "*");
        }
      })();
    `
    document.documentElement.appendChild(script)
    script.remove()
    
    // Timeout after 10 seconds (increased for caption fetching)
    setTimeout(() => {
      window.removeEventListener("message", messageHandler)
      reject(new Error("Timeout waiting for player response"))
    }, 10000)
  })
}

/**
 * Helper function to fetch with retry logic
 * Addresses issues with temporary network glitches or empty responses
 */
async function fetchWithRetry(url: string, retries = 3, delay = 1000): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    try {
      // Use background script to fetch to avoid CORS and header issues
      // The background script has host permissions for all URLs
      const response = await sendToBackground({
        name: "fetch-transcript",
        body: {
          captionUrl: url
        }
      })
      
      if (response && response.success && response.data) {
        return response.data
      }
      
      console.warn(`⚠️ Attempt ${i + 1}: Background fetch failed - ${response?.error || 'Unknown error'}`)
    } catch (error) {
      console.warn(`⚠️ Attempt ${i + 1}: Communication error - ${error.message}`)
    }
    
    if (i < retries - 1) {
      console.log(`⏳ Waiting ${delay}ms before retry...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  return null
}

export async function getVideoData(id: string) {
  console.log("🔍 Getting video data for:", id)
  
  try {
    let player = null;

    // Method 1: Fetch page HTML and extract ytInitialPlayerResponse (Recommended)
    console.log("🌐 Method 1: Fetching video page HTML...")
    try {
      const response = await fetch(`https://www.youtube.com/watch?v=${id}`);
      const html = await response.text();
      
      const splitStr = 'var ytInitialPlayerResponse =';
      if (html.includes(splitStr)) {
        const jsonStr = html.split(splitStr)[1].split(';var')[0];
        player = JSON.parse(jsonStr);
        console.log("✅ Successfully extracted player data from HTML")
      } else {
        console.warn("⚠️ ytInitialPlayerResponse not found in HTML")
      }
    } catch (e) {
      console.warn("⚠️ Method 1 failed:", e.message)
    }

    // Method 2: Inject script (Fallback)
    if (!player || !player.videoDetails) {
      console.log("💉 Method 2: Injecting script to read player data...")
      try {
        const response = await injectPageScript(false, null)
        player = response.playerResponse
        console.log("✅ Got player response from page context")
      } catch (e) {
        console.warn("⚠️ Method 2 failed:", e.message)
      }
    }

    if (!player || !player.videoDetails) {
      console.error("❌ Invalid player data")
      return {
        metadata: {
          title: "Error: Could not load video data",
          duration: "0",
          author: "Unknown",
          views: "0"
        },
        transcript: null
      }
    }

    // Extract metadata
    const metadata = {
      title: player.videoDetails.title,
      duration: player.videoDetails.lengthSeconds,
      author: player.videoDetails.author,
      views: player.videoDetails.viewCount
    }

    console.log("📝 Metadata:", metadata)
    console.log("🎤 Captions available:", !!player.captions)
    console.log("🎤 Caption tracks:", player.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length || 0)

    // Check if captions are available
    if (!player.captions || !player.captions.playerCaptionsTracklistRenderer) {
      console.warn("⚠️ No captions found for this video")
      return { metadata, transcript: null }
    }

    const tracks = player.captions.playerCaptionsTracklistRenderer.captionTracks
    if (!tracks || tracks.length === 0) {
      console.warn("⚠️ No caption tracks available")
      return { metadata, transcript: null }
    }

    console.log("📜 Found", tracks.length, "caption track(s)")
    console.log("📜 Track details:", tracks.map(t => ({ 
      lang: t.languageCode, 
      name: t.name?.simpleText, 
      kind: t.kind 
    })))
    
    // Sort tracks by priority (English, non-ASR first)
    tracks.sort(compareTracks)
    const selectedTrack = tracks[0]
    
    console.log("✅ Selected track:", {
      lang: selectedTrack.languageCode,
      name: selectedTrack.name?.simpleText,
      kind: selectedTrack.kind
    })

    // Fetch transcript with robust retry logic
    try {
      // Strategy 0: Extract from DOM (Most reliable, no network requests needed)
      const domTranscript = await extractTranscriptFromDOM()
      if (domTranscript && domTranscript.events && domTranscript.events.length > 0) {
        console.log("✅ Successfully extracted transcript from DOM")
        return { metadata, transcript: domTranscript }
      }
      
      // Strategy 1: Try fetching from page context (bypasses CORS and auth issues)
      console.log("🔗 Strategy 1: Fetching transcript from page context...")
      const jsonUrl = selectedTrack.baseUrl + "&fmt=json3"
      
      try {
        const pageResponse = await injectPageScript(true, jsonUrl)
        if (pageResponse.captionData) {
          console.log("✅ Got caption data from page context")
          try {
            const transcript = JSON.parse(pageResponse.captionData)
            if (transcript.events && Array.isArray(transcript.events)) {
              console.log("✅ Successfully parsed JSON3 transcript from page context")
              console.log("📊 Total events:", transcript.events.length)
              return { metadata, transcript }
            }
          } catch (parseError) {
            console.warn("⚠️ Page context JSON3 parse failed:", parseError.message)
          }
        } else if (pageResponse.captionError) {
          console.warn("⚠️ Page context fetch failed:", pageResponse.captionError)
        }
      } catch (pageError) {
        console.warn("⚠️ Strategy 1 failed:", pageError.message)
      }
      
      // Strategy 2: JSON3 format via background script (Fallback)
      console.log("🔗 Strategy 2: Fetching JSON3 transcript via background...")
      
      let text = await fetchWithRetry(jsonUrl)
      
      if (text) {
        try {
          const transcript = JSON.parse(text)
          if (transcript.events && Array.isArray(transcript.events)) {
            console.log("✅ Successfully parsed JSON3 transcript")
            console.log("📊 Total events:", transcript.events.length)
            return { metadata, transcript }
          }
        } catch (parseError) {
          console.warn("⚠️ JSON3 parse failed:", parseError.message)
        }
      }
      
      // Strategy 3: XML format (Fallback)
      console.log("🔄 Strategy 3: JSON3 failed or empty, trying XML fallback...")
      const xmlUrl = selectedTrack.baseUrl
      text = await fetchWithRetry(xmlUrl)
      
      if (text) {
        console.log("📄 XML response length:", text.length)
        
        // Parse XML
        const parser = new DOMParser()
        const xmlDoc = parser.parseFromString(text, "text/xml")
        const textElements = xmlDoc.getElementsByTagName('text')
        
        console.log("📊 XML text elements found:", textElements.length)
        
        if (textElements.length > 0) {
          const events = []
          
          for (let i = 0; i < textElements.length; i++) {
            const element = textElements[i]
            const start = parseFloat(element.getAttribute('start') || '0')
            const duration = parseFloat(element.getAttribute('dur') || '0')
            const content = element.textContent || ''
            
            if (content.trim()) {
              events.push({
                tStartMs: Math.floor(start * 1000),
                dDurationMs: Math.floor(duration * 1000),
                segs: [{ utf8: content.trim() }]
              })
            }
          }
          
          if (events.length > 0) {
            console.log("✅ Successfully parsed XML transcript")
            return { metadata, transcript: { events } }
          }
        }
      }

      // Strategy 4: VTT format (Fallback)
      console.log("🔄 Strategy 4: XML failed, trying VTT fallback...")
      const vttUrl = selectedTrack.baseUrl + "&fmt=vtt"
      text = await fetchWithRetry(vttUrl)
      
      if (text) {
        console.log("📄 VTT response length:", text.length)
        
        // Simple VTT parser
        const lines = text.split('\n')
        const events = []
        let currentTime = null
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim()
          
          // Match timestamp line (e.g., "00:00:00.000 --> 00:00:03.000")
          if (line.includes('-->')) {
            const times = line.split('-->').map(t => t.trim())
            const startParts = times[0].split(':')
            // Handle HH:MM:SS.mmm or MM:SS.mmm
            let startMs = 0
            if (startParts.length === 3) {
              startMs = (parseInt(startParts[0]) * 3600000) + (parseInt(startParts[1]) * 60000) + (parseFloat(startParts[2]) * 1000)
            } else if (startParts.length === 2) {
              startMs = (parseInt(startParts[0]) * 60000) + (parseFloat(startParts[1]) * 1000)
            }
            currentTime = startMs
          } else if (line && currentTime !== null && !line.match(/^\d+$/) && !line.startsWith('WEBVTT')) {
            // This is caption text
            events.push({
              tStartMs: Math.floor(currentTime),
              dDurationMs: 3000, // Default duration
              segs: [{ utf8: line }]
            })
            currentTime = null
          }
        }
        
        if (events.length > 0) {
          console.log("✅ Successfully parsed VTT transcript")
          return { metadata, transcript: { events } }
        }
      }
      
      console.error("❌ All transcript fetching strategies failed")
      return { metadata, transcript: null }
      
    } catch (fetchError) {
      console.error("❌ Error in transcript fetching process:", fetchError.message)
      return { metadata, transcript: null }
    }
    
  } catch (error) {
    console.error("❌ Error in getVideoData:", error.message)
    console.error("Stack trace:", error.stack)
    
    return {
      metadata: {
        title: "Error loading video",
        duration: "0",
        author: "Unknown",
        views: "0"
      },
      transcript: null
    }
  }
}

export function cleanJsonTranscript(transcript) {
  const chunks = []
  let currentChunk = ""
  let currentStartTime = transcript.events[0].tStartMs
  let currentEndTime = currentStartTime

  transcript.events.forEach((event) => {
    event.segs?.forEach((seg) => {
      const segmentText = seg.utf8.replace(/\n/g, " ")
      currentEndTime = event.tStartMs + (seg.tOffsetMs || 0)
      if ((currentChunk + segmentText).length > 300) {
        chunks.push({
          text: currentChunk.trim(),
          startTime: currentStartTime,
          endTime: currentEndTime
        })
        currentChunk = segmentText
        currentStartTime = currentEndTime
      } else {
        currentChunk += segmentText
      }
    })
  })

  if (currentChunk) {
    chunks.push({
      text: currentChunk.trim(),
      startTime: currentStartTime,
      endTime: currentEndTime
    })
  }

  return chunks
}

export function cleanTextTranscript(transcript) {
  // Initialize variables to hold lines of text and temporary segment text
  let textLines = []
  let tempText = ""
  let lastTime = 0

  // Loop through each event in the transcript
  transcript.events.forEach((event) => {
    // Check if there's a significant gap (5 seconds or more) between events
    if (event.tStartMs - lastTime > 5000 && tempText) {
      textLines.push(tempText.trim())
      tempText = ""
    }

    // Process each segment in the current event
    event.segs?.forEach((seg) => {
      const currentText = seg.utf8

      // If we're at the start of a new sentence (capital letter) and tempText is not empty, push it to textLines
      if (/^[A-Z]/.test(currentText) && tempText) {
        textLines.push(tempText.trim())
        tempText = currentText
      } else {
        // Otherwise, accumulate the text in tempText
        tempText += currentText
      }
    })

    // Update the last event time
    lastTime = event.tStartMs
  })

  // Push any remaining accumulated text to textLines
  if (tempText) {
    textLines.push(tempText.trim())
  }

  return textLines.join("\n")
}
