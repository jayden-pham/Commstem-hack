"use client"

import type React from "react"

import { useRouter } from "next/navigation"
import Image from "next/image"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Move3d, Shuffle, Accessibility } from "lucide-react"

export default function LandingPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000"

  const processFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return
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
        const reader = new FileReader()
        reader.onload = (e) => {
          const imageData = e.target?.result as string
          localStorage.setItem("uploadedImage", imageData)
          router.push("/chat")
        }
        if (file) reader.readAsDataURL(file)
      }
    })()
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    processFile(file)
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer?.files?.[0]
    processFile(file)
  }

  return (
    <div className="relative min-h-screen bg-white">
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(1000px_600px_at_80%_-10%,oklch(0.97_0_0)_0%,transparent_60%),radial-gradient(800px_400px_at_10%_10%,oklch(0.97_0_0)_0%,transparent_60%)]" />

      <header className="relative z-10 flex items-center justify-between max-w-7xl mx-auto px-6 py-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Image src="/evolv-logo.png" alt="Evolv" width={140} height={42} className="h-8 w-auto" />
          <span className="hidden sm:inline-block text-sm text-gray-500">Ideas that grow with you</span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/chat")}>
            Open Editor
          </Button>
          <Button size="sm" onClick={handleUploadClick}>Upload</Button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
        </div>
      </header>

      <main className="relative z-10">
        <section className="max-w-7xl mx-auto px-6 lg:px-8 pt-8 pb-12 lg:pt-16 lg:pb-20 grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-6 flex flex-col justify-center gap-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/60 px-3 py-1 w-max text-xs text-gray-600 backdrop-blur">
              <span className="size-1.5 rounded-full bg-gray-400" />
              Evolve visuals through incremental refinement
            </div>
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gray-900">
              Shape ideas by selecting what to change — and evolve the rest
            </h1>
            <p className="text-base md:text-lg leading-relaxed text-gray-600 max-w-xl">
              Evolv turns rough concepts into refined visuals one step at a time. Draw a box, nudge a detail, and watch your image grow with each iteration.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleUploadClick}>Start with an image</Button>
              <Button variant="outline" onClick={() => router.push("/chat")}>Try the editor</Button>
            </div>
            <div className="flex items-center gap-6 pt-2 text-sm text-gray-500">
              <div className="flex -space-x-2">
                <Image src="/placeholder-user.jpg" alt="" width={32} height={32} className="size-8 rounded-full ring-2 ring-white" />
                <Image src="/placeholder.jpg" alt="" width={32} height={32} className="size-8 rounded-full ring-2 ring-white" />
                <Image src="/placeholder-logo.png" alt="" width={32} height={32} className="size-8 rounded-full ring-2 ring-white" />
              </div>
              <span>Built for clarity, control, and creative flow</span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div
              className={
                "relative rounded-2xl border bg-white shadow-sm p-3 md:p-4 transition-colors " +
                (isDragging ? "border-primary/60 bg-accent/40" : "border-gray-200")
              }
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="pointer-events-none absolute -inset-0.5 rounded-2xl bg-gradient-to-tr from-transparent via-transparent to-black/5 blur-2xl" />
              <div className="relative grid grid-cols-2 gap-3 md:gap-4">
                <div className="aspect-[4/3] overflow-hidden rounded-xl bg-gray-50">
                  <Image src="/evolved-landscape-1.jpg" alt="Sample 1" width={800} height={600} className="size-full object-cover" />
                </div>
                <div className="aspect-[4/3] overflow-hidden rounded-xl bg-gray-50">
                  <Image src="/evolved-landscape-2.jpg" alt="Sample 2" width={800} height={600} className="size-full object-cover" />
                </div>
                <div className="aspect-[4/3] overflow-hidden rounded-xl bg-gray-50">
                  <Image src="/evolved-landscape-3.jpg" alt="Sample 3" width={800} height={600} className="size-full object-cover" />
                </div>
                <div className="aspect-[4/3] overflow-hidden rounded-xl bg-gray-50">
                  <Image src="/evolved-landscape-4.jpg" alt="Sample 4" width={800} height={600} className="size-full object-cover" />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-sm text-gray-600">
                  {isDragging ? "Drop image to start evolving" : "Upload or drag an image to begin"}
                </div>
                <Button size="sm" onClick={handleUploadClick}>Upload</Button>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 lg:px-8 pb-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-900">
                <Move3d className="size-4 text-gray-700" /> Precise control
              </div>
              <p className="text-sm text-gray-600">Select a region to modify exactly what matters without disturbing the rest.</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-900">
                <Shuffle className="size-4 text-gray-700" /> Natural evolution
              </div>
              <p className="text-sm text-gray-600">Iterate step‑by‑step, guiding changes toward your vision with minimal friction.</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-900">
                <Accessibility className="size-4 text-gray-700" /> Accessible to all
              </div>
              <p className="text-sm text-gray-600">No prompt‑crafting needed. Explore ideas visually and grow them organically.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-8 text-sm text-gray-500 flex items-center justify-between">
          <span>© {new Date().getFullYear()} Evolv</span>
          <div className="flex items-center gap-6">
            <a className="hover:text-gray-700" href="#">Privacy</a>
            <a className="hover:text-gray-700" href="#">Terms</a>
            <a className="hover:text-gray-700" href="#">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
