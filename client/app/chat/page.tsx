"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import Image from "next/image"
import { Upload, Menu, X } from "lucide-react"
import CanvasEditor from "@/components/canvas-editor"

interface SavedChat {
  id: number
  name: string
  messages: Array<{ type: "user" | "ai"; content: string; isImage?: boolean }>
  finalImage: string | null
}

export default function ChatPage() {
  const [isNavOpen, setIsNavOpen] = useState(true)
  const [currentImage, setCurrentImage] = useState<string | null>(null) // The image that can be edited
  const [originalImage, setOriginalImage] = useState<string | null>(null) // The original unedited image
  const [prompt, setPrompt] = useState("")
  const [generatedImages, setGeneratedImages] = useState<Array<{ id: number; url: string }>>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [chatMessages, setChatMessages] = useState<Array<{ type: "user" | "ai"; content: string; isImage?: boolean }>>(
    [],
  )
  const [savedChats, setSavedChats] = useState<SavedChat[]>([])
  const [currentChatId, setCurrentChatId] = useState<number | null>(null)
  const searchParams = useSearchParams()
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000"

  useEffect(() => {
    // 1) Read the values we already stored on landing
    const savedImage = localStorage.getItem("uploadedImage");
    const qpCid = searchParams.get("cid");
    const lsCid = typeof window !== "undefined" ? localStorage.getItem("conversationId") : null;
    const cid = qpCid || lsCid;
  
    // Show the image immediately
    if (savedImage) {
      setCurrentImage(savedImage);
      setOriginalImage(savedImage);
      setChatMessages([{ type: "user", content: savedImage, isImage: true }]);
      localStorage.removeItem("uploadedImage");
    }
  
    // Set conversation id so Generate can use it
    if (cid) {
      setCurrentChatId(Number(cid));
      localStorage.removeItem("conversationId");
    }
  
    // Load any locally-saved chats
    const storedChats = localStorage.getItem("evolv-chats");
    if (storedChats) setSavedChats(JSON.parse(storedChats));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSavedChat = (chat: SavedChat) => {
    setChatMessages(chat.messages)
    setCurrentImage(chat.finalImage)
    setOriginalImage(chat.finalImage)
    setCurrentChatId(chat.id)
    setGeneratedImages([])
    setPrompt("")
  }

  const startNewChat = () => {
    setChatMessages([])
    setCurrentImage(null)
    setOriginalImage(null)
    setGeneratedImages([])
    setPrompt("")
    setCurrentChatId(null)
  }

  const handleCanvasSave = (editedImageUrl: string) => {
    setChatMessages((prev) => [...prev, { type: "user", content: editedImageUrl, isImage: true }])
    setCurrentImage(editedImageUrl)
    setIsFullScreen(false)
  }

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const imageUrl = e.target?.result as string
      setCurrentImage(imageUrl)
      setOriginalImage(imageUrl)
      setChatMessages([{ type: "user", content: imageUrl, isImage: true }])
    }
    reader.readAsDataURL(file)
  }

  const handleGenerate = async () => {
    if (prompt.trim()) {
      setChatMessages((prev) => [...prev, { type: "user", content: prompt.trim(), isImage: false }])
    }

    setIsGenerating(true)

    try {
      const cid = searchParams.get("cid") || localStorage.getItem("conversationId")
      if (!cid) throw new Error("No conversation id")
      if (!currentImage || !originalImage) throw new Error("No images to edit")

      const formData = new FormData()
      const baseResp = await fetch(originalImage)
      const baseBlob = await baseResp.blob()
      formData.append("original", baseBlob, "original.png")

      const boxedResp = await fetch(currentImage)
      const boxedBlob = await boxedResp.blob()
      formData.append("modified", boxedBlob, "modified.png")

      formData.append("prompt", prompt.trim())

      const resp = await fetch(`${BACKEND_URL}/conversations/${cid}/edits`, { method: "POST", body: formData })
      if (!resp.ok) throw new Error(`Generate failed: ${resp.status}`)
      const data = await resp.json()
      const outs = (data?.outputs || []) as Array<{ image_id: number; url: string }>
      if (!Array.isArray(outs) || outs.length === 0) throw new Error("No outputs")
      setGeneratedImages(outs.map((o) => ({ id: o.image_id, url: `${BACKEND_URL}/images/${o.image_id}` })))
    } catch (error) {
      console.error("[v0] Generation error:", error)

      const fallbackImages = ["/evolved-landscape-1.jpg", "/evolved-landscape-2.jpg", "/evolved-landscape-3.jpg", "/evolved-landscape-4.jpg"].map(
        (u, i) => ({ id: -1 - i, url: u }),
      )
      setGeneratedImages(fallbackImages)
    } finally {
      setIsGenerating(false)
      setPrompt("")
    }
  }

  const handleImageSelect = async (sel: { id: number; url: string }) => {
    try {
      const cid = searchParams.get("cid") || localStorage.getItem("conversationId")
      if (cid && sel.id > 0) {
        await fetch(`${BACKEND_URL}/conversations/${cid}/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selected_image_id: sel.id }),
        })
      }
    } catch (e) {
      // non-fatal
    }
    setChatMessages((prev) => [...prev, { type: "user", content: sel.url, isImage: true }])
    setCurrentImage(sel.url)
    setOriginalImage(sel.url)
    setGeneratedImages([])
    setPrompt("")
  }

  const handleComplete = () => {
    if (!currentImage || chatMessages.length === 0) return

    const nextChatNumber = savedChats.length + 1
    const newSavedChat: SavedChat = {
      id: nextChatNumber,
      name: `Chat ${nextChatNumber}`,
      messages: [...chatMessages],
      finalImage: currentImage,
    }

    const updatedChats = [...savedChats, newSavedChat]
    setSavedChats(updatedChats)
    localStorage.setItem("evolv-chats", JSON.stringify(updatedChats))

    const link = document.createElement("a")
    link.href = currentImage
    link.download = `evolv-chat-${nextChatNumber}-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    startNewChat()
  }

  return (
    <div className="min-h-screen bg-white flex">
      {isFullScreen && currentImage && (
        <CanvasEditor image={currentImage} onSave={handleCanvasSave} onClose={() => setIsFullScreen(false)} />
      )}

      <div className={`${isNavOpen ? "w-64" : "w-0"} transition-all duration-300 overflow-hidden bg-gray-50 border-r`}>
        <div className="p-4 space-y-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">
              e
            </div>
          </div>

          <button
            onClick={startNewChat}
            className="flex items-center gap-3 p-2 hover:bg-gray-100 rounded-lg w-full text-left"
          >
            <Image src="/upload-button.png" alt="New seed" width={24} height={24} />
            <span className="text-gray-700">New seed</span>
          </button>

          <div className="space-y-3">
            <h3 className="text-gray-400 text-sm font-medium">Chats</h3>
            <div className="space-y-1">
              {savedChats.map((chat) => (
                <div
                  key={chat.id}
                  className={`p-2 text-gray-600 hover:bg-gray-100 rounded cursor-pointer ${
                    currentChatId === chat.id ? "bg-gray-200" : ""
                  }`}
                  onClick={() => loadSavedChat(chat)}
                >
                  {chat.name}
                </div>
              ))}
              {savedChats.length === 0 && <div className="p-2 text-gray-400 text-sm">No saved chats yet</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="border-b p-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => setIsNavOpen(!isNavOpen)} className="p-2">
            {isNavOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </Button>
          <Button
            className="border-0 rounded-full px-6 text-gray-800 font-medium"
            style={{ backgroundColor: "#a7c19c" }}
            onClick={handleComplete}
            disabled={!currentImage || chatMessages.length === 0}
          >
            Complete
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-6">
            {!currentImage ? (
              <div className="text-center space-y-8 mt-20">
                <Image src="/evolv-logo.png" alt="Evolv.ai" width={200} height={60} className="mx-auto" />
                <p className="text-gray-600 text-lg">
                  Draw on the image to begin prompting changes or type a text prompt
                </p>

                <Card className="p-16 border-dashed border-2 max-w-md mx-auto">
                  <div className="space-y-4">
                    <Upload className="w-16 h-16 mx-auto text-muted-foreground" />
                    <h3 className="text-xl font-semibold">Upload an image</h3>
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="upload" />
                    <label htmlFor="upload">
                      <Button asChild>
                        <span>Choose Image</span>
                      </Button>
                    </label>
                  </div>
                </Card>
              </div>
            ) : (
              <div className="space-y-6">
                {chatMessages.map((message, index) => (
                  <div key={index} className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-lg">
                      <div className="bg-gray-100 p-3 rounded-2xl rounded-br-md">
                        {message.isImage ? (
                          <img
                            src={message.content || "/placeholder.svg"}
                            alt={message.type === "user" ? "User image" : "AI generated"}
                            className={`w-full rounded-lg select-none ${
                              message.content === currentImage
                                ? "cursor-pointer hover:opacity-90 transition-opacity"
                                : ""
                            }`}
                            onClick={() => {
                              if (message.content === currentImage) {
                                setIsFullScreen(true)
                              }
                            }}
                            draggable={false}
                          />
                        ) : (
                          <p>{message.content}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {generatedImages.length > 0 && (
                  <div className="flex justify-start">
                    <div className="max-w-2xl">
                      <div className="bg-gray-100 p-4 rounded-2xl rounded-bl-md">
                        <p className="text-sm text-gray-600 mb-3">Pick one to evolve further:</p>
                        <div className="grid grid-cols-2 gap-3">
                          {generatedImages.map((out, i) => (
                            <Card
                              key={i}
                              className="p-2 cursor-pointer hover:shadow-lg transition-shadow"
                              onClick={() => handleImageSelect(out)}
                            >
                              <img
                                src={out.url || "/placeholder.svg"}
                                alt={`Option ${i + 1}`}
                                className="w-full aspect-square object-cover rounded select-none"
                                draggable={false}
                              />
                            </Card>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {isGenerating && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 p-4 rounded-2xl rounded-bl-md">
                      <div className="flex items-center space-x-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                        <span className="text-gray-600">Generating images...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t p-4">
          <div className="max-w-4xl mx-auto">
            <div className="bg-gray-100 rounded-full px-6 py-4 flex items-center space-x-3">
              <input
                type="text"
                placeholder="Ask anything"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-gray-700 placeholder-gray-500"
              />
              {currentImage && (
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating || !currentChatId || !currentImage || !originalImage}
                  className="bg-[#a7c19c] hover:bg-[#95b089] text-white px-6 py-2 rounded-full"
                >
                  {isGenerating ? "Generating..." : "Generate"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}