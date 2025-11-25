import type { PlasmoMessaging } from "@plasmohq/messaging"

/**
 * Background script handler for fetching YouTube transcripts
 * This runs in the background context which has better permissions for cross-origin requests
 */
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const { captionUrl, videoId, lang } = req.body

  console.log("🔧 Background: Fetching transcript...")
  console.log("  Video ID:", videoId)
  console.log("  Language:", lang)
  console.log("  Caption URL:", captionUrl)

  try {
    // Try multiple methods to fetch the transcript
    
    // Method 1: Use the provided caption URL
    if (captionUrl) {
      console.log("🔗 Method 1: Using provided caption URL...")
      try {
        const response = await fetch(captionUrl)
        console.log("📥 Response status:", response.status)
        
        if (response.ok) {
          const text = await response.text()
          console.log("📄 Response length:", text.length)
          
          if (text && text.length > 0) {
            console.log("✅ Successfully fetched transcript via caption URL")
            res.send({ success: true, data: text, method: "captionUrl" })
            return
          }
        }
      } catch (error) {
        console.warn("⚠️ Caption URL fetch failed:", error.message)
      }
    }

    // Method 2: Try YouTube's timedtext API
    console.log("🔗 Method 2: Using YouTube timedtext API...")
    const timedtextUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang || 'en'}`
    
    try {
      const response = await fetch(timedtextUrl)
      console.log("📥 Timedtext response status:", response.status)
      
      if (response.ok) {
        const text = await response.text()
        console.log("📄 Timedtext response length:", text.length)
        
        if (text && text.length > 0) {
          console.log("✅ Successfully fetched transcript via timedtext API")
          res.send({ success: true, data: text, method: "timedtext" })
          return
        }
      }
    } catch (error) {
      console.warn("⚠️ Timedtext API fetch failed:", error.message)
    }

    // Method 3: Try with fmt=srv3
    console.log("🔗 Method 3: Trying fmt=srv3...")
    const srv3Url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang || 'en'}&fmt=srv3`
    
    try {
      const response = await fetch(srv3Url)
      console.log("📥 srv3 response status:", response.status)
      
      if (response.ok) {
        const text = await response.text()
        console.log("📄 srv3 response length:", text.length)
        
        if (text && text.length > 0) {
          console.log("✅ Successfully fetched transcript via srv3 format")
          res.send({ success: true, data: text, method: "srv3" })
          return
        }
      }
    } catch (error) {
      console.warn("⚠️ srv3 format fetch failed:", error.message)
    }

    console.error("❌ All background fetch methods failed")
    res.send({ 
      success: false, 
      error: "All transcript fetch methods returned empty responses" 
    })

  } catch (error) {
    console.error("❌ Background fetch error:", error)
    res.send({ 
      success: false, 
      error: error.message 
    })
  }
}

export default handler
