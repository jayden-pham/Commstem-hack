"use client"

import type React from "react"

import { useRouter } from "next/navigation"
import Image from "next/image"
import { useRef } from "react"

export default function LandingPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000"

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type.startsWith("image/")) {
      ;(async () => {
        try {
          const form = new FormData()
          form.append("image", file)
          const resp = await fetch(`${BACKEND_URL}/conversations`, { method: "POST", body: form })
          if (!resp.ok) throw new Error(`create conversation failed: ${resp.status}`)
          const data: { id: number; title: string; current_image?: { id: number; url: string } } = await resp.json()
          const imgUrl = data.current_image?.url ? `${BACKEND_URL}${data.current_image.url}` : ""
          if (imgUrl) {
            localStorage.setItem("uploadedImage", imgUrl)
          }
          localStorage.setItem("conversationId", String(data.id))
          router.push(`/chat?cid=${data.id}`)
        } catch (err) {
          // Fallback to local preview-only flow
          const reader = new FileReader()
          reader.onload = (e) => {
            const imageData = e.target?.result as string
            localStorage.setItem("uploadedImage", imageData)
            router.push("/chat")
          }
          reader.readAsDataURL(file)
        }
      })()
    }
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-8">
      <div className="max-w-7xl w-full grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
        <div className="space-y-8">
          <div className="space-y-4">
            <Image src="/evolv-logo.png" alt="Evolv.ai" width={400} height={120} />
            <h1 className="text-2xl font-medium text-gray-600">Ideas that grow with you</h1>
          </div>

          <div className="space-y-6 text-gray-800 leading-relaxed">
            <p>
              In nature, change happens step by step. Small mutations, guided by selection, shape life into what
              survives and thrives. Evolv takes this principle and brings it into creativity — turning abstract ideas
              into real visuals through incremental refinement.
            </p>

            <p>
              We believe everyone has ideas worth expressing, but not everyone has the words or tools to describe them.
              Evolv empowers people to show what they want, not just struggle to say it. By highlighting, evolving, and
              refining, anyone can grow their imagination into something vivid.
            </p>

            <div className="space-y-4">
              <h2 className="font-semibold text-gray-900">What Makes Evolv Different</h2>
              <ul className="space-y-2">
                <li>
                  <strong>Precise Control:</strong> Draw a box to change exactly what you want.
                </li>
                <li>
                  <strong>Natural Process:</strong> Step-by-step refinement, inspired by evolution.
                </li>
                <li>
                  <strong>Accessible to All:</strong> No design skills needed — just curiosity.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex justify-center items-center">
          <div
            onClick={handleUploadClick}
            className="flex flex-col items-center space-y-6 p-16 hover:bg-gray-50 rounded-2xl transition-colors cursor-pointer group"
          >
            <Image
              src="/upload-button.png"
              alt="Upload New Images"
              width={300}
              height={300}
              className="w-64 h-64 group-hover:scale-105 transiontion-transform"
            />
            <p>Upload Image Here</p>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
          </div>
        </div>
      </div>
    </div>
  )
}
