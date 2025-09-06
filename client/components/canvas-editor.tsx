"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { X, Type, Paintbrush, Undo, Redo, Download } from "lucide-react"

interface CanvasEditorProps {
  image: string
  onSave: (editedImageUrl: string) => void
  onClose: () => void
}

export default function CanvasEditor({ image, onSave, onClose }: CanvasEditorProps) {
  const [selectedTool, setSelectedTool] = useState<"brush" | "text">("brush")
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawingHistory, setDrawingHistory] = useState<ImageData[]>([])
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1)
  const [editingText, setEditingText] = useState<string | null>(null)
  const [tempText, setTempText] = useState("")
  const [pendingTextCssPos, setPendingTextCssPos] = useState<{ left: number; top: number } | null>(null)
  const textNaturalPos = useRef<{ x: number; y: number } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const getDPR = () => (typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1)

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const imageElement = imageRef.current
    if (!canvas || !imageElement) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = getDPR()
    const natW = imageElement.naturalWidth || imageElement.width
    const natH = imageElement.naturalHeight || imageElement.height

    canvas.width = Math.max(1, Math.floor(natW * dpr))
    canvas.height = Math.max(1, Math.floor(natH * dpr))

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)

    const rect = imageElement.getBoundingClientRect()
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "#000000"
    ctx.lineWidth = 3

    const blank = ctx.getImageData(0, 0, canvas.width, canvas.height)
    setDrawingHistory([blank])
    setCurrentHistoryIndex(0)
  }, [])

  useEffect(() => {
    const img = imageRef.current
    if (!img) return
    const obs = new ResizeObserver(() => setupCanvas())
    obs.observe(img)
    return () => obs.disconnect()
  }, [setupCanvas])

  const clientToNatural = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const imageElement = imageRef.current
    if (!imageElement) return { x: 0, y: 0 }

    const natW = imageElement.naturalWidth || imageElement.width
    const natH = imageElement.naturalHeight || imageElement.height
    const relX = e.clientX - rect.left
    const relY = e.clientY - rect.top
    const x = (relX / rect.width) * natW
    const y = (relY / rect.height) * natH
    return { x, y }
  }

  const naturalToCss = (nat: { x: number; y: number }) => {
    const imageElement = imageRef.current
    if (!imageElement) return { left: 0, top: 0 }
    const rect = imageElement.getBoundingClientRect()
    const natW = imageElement.naturalWidth || imageElement.width
    const natH = imageElement.naturalHeight || imageElement.height
    const left = (nat.x / natW) * rect.width
    const top = (nat.y / natH) * rect.height
    return { left, top }
  }

  const beginStroke = (x: number, y: number) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    setIsDrawing(true)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const contStroke = (x: number, y: number) => {
    if (!isDrawing || selectedTool !== "brush") return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const endStroke = () => {
    if (!isDrawing) return
    setIsDrawing(false)

    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height)
    setDrawingHistory((prev) => {
      const next = prev.slice(0, currentHistoryIndex + 1)
      next.push(snap)
      const MAX = 75
      const trimmed = next.length > MAX ? next.slice(next.length - MAX) : next
      setCurrentHistoryIndex(trimmed.length - 1)
      return trimmed
    })
  }

  const handleTextPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const nat = clientToNatural(e)
    textNaturalPos.current = nat
    const css = naturalToCss(nat)
    setPendingTextCssPos(css)
    const id = `${Date.now()}`
    setEditingText(id)
    setTempText("")
  }

  const commitText = () => {
    if (!editingText || !tempText.trim()) {
      setEditingText(null)
      setTempText("")
      setPendingTextCssPos(null)
      return
    }

    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const nat = textNaturalPos.current
    if (!nat) return

    ctx.save()
    ctx.font = "24px Arial"
    ctx.fillStyle = "#000000"
    ctx.textBaseline = "top"
    ctx.fillText(tempText, nat.x, nat.y)
    ctx.restore()

    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const next = drawingHistory.slice(0, currentHistoryIndex + 1)
    next.push(snap)
    setDrawingHistory(next)
    setCurrentHistoryIndex(next.length - 1)

    setEditingText(null)
    setTempText("")
    setPendingTextCssPos(null)
    textNaturalPos.current = null
  }

  const undo = () => {
    if (currentHistoryIndex <= 0) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const prevIndex = currentHistoryIndex - 1
    ctx.putImageData(drawingHistory[prevIndex], 0, 0)
    setCurrentHistoryIndex(prevIndex)
  }

  const redo = () => {
    if (currentHistoryIndex >= drawingHistory.length - 1) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const nextIndex = currentHistoryIndex + 1
    ctx.putImageData(drawingHistory[nextIndex], 0, 0)
    setCurrentHistoryIndex(nextIndex)
  }

  const handleSave = () => {
    try {
      const canvas = canvasRef.current
      const imageElement = imageRef.current

      if (canvas && imageElement) {
        const compositeCanvas = document.createElement("canvas")
        const compositeCtx = compositeCanvas.getContext("2d")

        if (compositeCtx) {
          compositeCanvas.width = imageElement.naturalWidth || imageElement.width
          compositeCanvas.height = imageElement.naturalHeight || imageElement.height

          compositeCtx.drawImage(imageElement, 0, 0)

          const dpr = getDPR()
          const scaledWidth = imageElement.naturalWidth || imageElement.width
          const scaledHeight = imageElement.naturalHeight || imageElement.height

          compositeCtx.drawImage(
            canvas,
            0,
            0,
            canvas.width,
            canvas.height, // Source dimensions (full DPR scaled canvas)
            0,
            0,
            scaledWidth,
            scaledHeight, // Destination dimensions (original image size)
          )

          const editedImageUrl = compositeCanvas.toDataURL("image/png")
          onSave(editedImageUrl)
        }
      } else {
        onSave(image)
      }
    } catch (error) {
      console.error("Save error:", error)
      onClose()
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (selectedTool === "text") {
      handleTextPointerDown(e)
    } else {
      const { x, y } = clientToNatural(e)
      beginStroke(x, y)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (selectedTool !== "brush") return
    const { x, y } = clientToNatural(e)
    contStroke(x, y)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    endStroke()
  }

  return (
    <div className="fixed inset-0 bg-white z-50 flex">
      <div className="w-16 bg-[#a7c19c] flex flex-col items-center py-4 space-y-4">
        <Button
          variant={selectedTool === "brush" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSelectedTool("brush")}
          className="w-10 h-10 p-0"
        >
          <Paintbrush className="w-5 h-5" />
        </Button>

        <Button
          variant={selectedTool === "text" ? "default" : "ghost"}
          size="sm"
          onClick={() => setSelectedTool("text")}
          className="w-10 h-10 p-0"
        >
          <Type className="w-5 h-5" />
        </Button>

        <Button variant="ghost" size="sm" onClick={undo} disabled={currentHistoryIndex <= 0} className="w-10 h-10 p-0">
          <Undo className="w-5 h-5" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={redo}
          disabled={currentHistoryIndex >= drawingHistory.length - 1}
          className="w-10 h-10 p-0"
        >
          <Redo className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 relative flex items-center justify-center">
        <Button onClick={onClose} className="absolute top-4 right-4 z-20" variant="ghost" size="sm">
          <X className="w-6 h-6 text-black" />
        </Button>

        <div ref={containerRef} className="relative max-w-full max-h-full">
          <img
            ref={imageRef}
            src={image || "/placeholder.svg"}
            alt="Canvas editor"
            className="max-w-full max-h-full object-contain select-none"
            onLoad={setupCanvas}
            crossOrigin="anonymous"
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 cursor-crosshair touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />

          {editingText && pendingTextCssPos && (
            <div
              className="absolute bg-white p-2 rounded shadow-lg border"
              style={{ left: pendingTextCssPos.left, top: pendingTextCssPos.top }}
            >
              <input
                type="text"
                value={tempText}
                onChange={(e) => setTempText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitText()
                  if (e.key === "Escape") {
                    setEditingText(null)
                    setTempText("")
                    setPendingTextCssPos(null)
                  }
                }}
                placeholder="Enter text..."
                className="border rounded px-2 py-1"
                autoFocus
              />
              <Button onClick={commitText} size="sm" className="ml-2">
                Add
              </Button>
            </div>
          )}
        </div>

        <Button
          onClick={() => handleSave()}
          className="absolute bottom-4 right-4 bg-[#a7c19c] hover:bg-[#95b089] text-gray-800"
        >
          <Download className="w-4 h-4 mr-2" />
          Save
        </Button>
      </div>
    </div>
  )
}
