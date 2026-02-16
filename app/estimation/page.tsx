"use client"

import { useEffect, useState } from "react"
import {
  FileText,
  TrendingUp,
  Cpu,
  Download,
  FileSpreadsheet,
  Building2,
  MapPin,
  IndianRupee,
  Ruler,
  AlertCircle,
  Rocket,
  CalendarDays,
  CheckCircle2,
  History,
  Save,
} from "lucide-react"
import { Treemap, ResponsiveContainer, Tooltip } from "recharts"
import { useRouter } from "next/navigation"
import { TopNav } from "@/components/layout/topnav"
import { UploadZone } from "@/components/estimation/upload-zone"
import { BOQTable } from "@/components/estimation/boq-table"
import { MarketRangeCard } from "@/components/estimation/market-range"
import { RiskFlags } from "@/components/estimation/risk-flags"
import type { EstimationResult, EstimationSection } from "@/lib/estimation-types"

type ErrorWithMessage = Error & { message: string }

// Treemap content renderer
interface TreemapContentProps {
  x?: number
  y?: number
  width?: number
  height?: number
  name?: string
  fill?: string
}

interface LaunchFormState {
  projectName: string
  clientName: string
  clientEmail: string
  address: string
  type: string
  startDate: string
  budgetMode: "lean" | "balanced" | "premium"
}

interface LaunchResponse {
  projectId: string
  projectName: string
  schedule: Array<{
    id: string
    name: string
    duration: number
    predecessors: string[]
    dependencies?: Array<{
      activityId: string
      type: "FS" | "SS" | "FF" | "SF"
      lagDays?: number
    }>
    status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED"
    notes?: string
  }>
}

interface EstimationHistoryItem {
  id: string
  fileName: string
  location: string
  grandTotal: number
  grandTotalLabel: string
  confidenceScore: number | null
  createdAt: string
  projectName: string | null
}

interface SavedEstimationResponse extends EstimationResult {
  fileName?: string
}

const CustomizedContent = (props: TreemapContentProps) => {
  const { x = 0, y = 0, width = 0, height = 0, name, fill } = props

  if (width < 60 || height < 40) return null

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{ fill, stroke: "#fff", strokeWidth: 2 }}
        rx={4}
      />
      <text
        x={x + width / 2}
        y={y + height / 2}
        textAnchor="middle"
        fill="#fff"
        fontSize={11}
        fontWeight={500}
      >
        {name}
      </text>
    </g>
  )
}

export default function EstimationPage() {
  const router = useRouter()
  const [result, setResult] = useState<EstimationResult | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [fileName, setFileName] = useState<string>("")
  const [isSavingEstimation, setIsSavingEstimation] = useState(false)
  const [historyItems, setHistoryItems] = useState<EstimationHistoryItem[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null)
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [launchSuccess, setLaunchSuccess] = useState<string | null>(null)
  const [launchForm, setLaunchForm] = useState<LaunchFormState>({
    projectName: "",
    clientName: "",
    clientEmail: "",
    address: "",
    type: "Residential",
    startDate: new Date().toISOString().split("T")[0],
    budgetMode: "balanced",
  })

  // Editable sections state (separate from raw result for live edits)
  const [editableSections, setEditableSections] = useState<EstimationSection[]>([])

  const handleFileSelect = async (file: File) => {
    setIsUploading(true)
    setUploadError(null)
    setFileName(file.name)
    const formData = new FormData()
    formData.append("file", file)

    try {
      const response = await fetch("/api/estimate", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error + (data.details ? `: ${data.details}` : "") || "Failed to analyze document")
      }

      setResult(data)
      setEditableSections(JSON.parse(JSON.stringify(data.sections || [])))
    } catch (error: unknown) {
      const err = error as ErrorWithMessage
      console.error("Error uploading file:", error)
      setUploadError(err.message || "Failed to analyze document. Please try again.")
    } finally {
      setIsUploading(false)
      void fetchHistory()
    }
  }

  const fetchHistory = async () => {
    setIsLoadingHistory(true)
    setHistoryError(null)
    try {
      const response = await fetch("/api/estimate/history")
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Failed to load estimation history")
      }
      setHistoryItems(data.estimations || [])
    } catch (error: unknown) {
      const err = error as ErrorWithMessage
      setHistoryError(err.message || "Failed to load estimation history.")
    } finally {
      setIsLoadingHistory(false)
    }
  }

  const loadFromHistory = async (id: string) => {
    setLoadingHistoryId(id)
    setUploadError(null)
    setLaunchError(null)
    setLaunchSuccess(null)
    try {
      const response = await fetch(`/api/estimate/history/${id}`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Failed to load saved estimation")
      }
      const saved = data as SavedEstimationResponse
      setResult(saved)
      setEditableSections(JSON.parse(JSON.stringify(saved.sections || [])))
      setFileName(saved.fileName || "Saved estimation")
    } catch (error: unknown) {
      const err = error as ErrorWithMessage
      setUploadError(err.message || "Failed to load saved estimation.")
    } finally {
      setLoadingHistoryId(null)
    }
  }

  const handleRateChange = (sectionIdx: number, itemIdx: number, newRate: number) => {
    setEditableSections((prev) => {
      const updated = JSON.parse(JSON.stringify(prev))
      const item = updated[sectionIdx].items[itemIdx]
      item.rate_inr = newRate
      // Recalculate: total = qty × rate × (1 + wastage%)
      item.total_inr = Math.round(item.quantity * newRate * (1 + (item.wastage_percent || 0) / 100))
      // Recalculate section subtotal
      updated[sectionIdx].subtotal_inr = updated[sectionIdx].items.reduce(
        (sum: number, i: EstimationSection["items"][number]) => sum + i.total_inr,
        0
      )
      return updated
    })
  }

  const grandTotal = editableSections.reduce((sum, s) => sum + s.subtotal_inr, 0)

  useEffect(() => {
    if (!result) return
    const cleanName = fileName.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ").trim()
    setLaunchForm((prev) => ({
      ...prev,
      projectName: prev.projectName || (cleanName ? `${cleanName} Project` : "New Project"),
      clientEmail: prev.clientEmail || "client@civvision.com",
      address: prev.address || result.project_summary?.location || "Project site address",
    }))
  }, [result, fileName])

  useEffect(() => {
    void fetchHistory()
  }, [])

  const handleExport = async (format: "excel" | "pdf") => {
    if (!result) return
    setIsExporting(true)

    try {
      const exportData = {
        ...result,
        sections: editableSections,
        grand_total_inr: grandTotal,
      }

      const response = await fetch("/api/estimate/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, data: exportData }),
      })

      if (!response.ok) {
        throw new Error("Export failed")
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `CivVision_Estimation_${new Date().toISOString().split("T")[0]}.${format === "excel" ? "xlsx" : "pdf"}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error: unknown) {
      console.error("Export error:", error)
      alert("Export failed. Please try again.")
    } finally {
      setIsExporting(false)
    }
  }

  const formatINR = (amount: number): string => {
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`
    return `₹${amount.toLocaleString("en-IN")}`
  }

  const handleSaveEstimation = async () => {
    if (!result?.estimationId) {
      setUploadError("No saved estimation found yet. Upload first to create one.")
      return
    }

    setIsSavingEstimation(true)
    setUploadError(null)
    try {
      const response = await fetch(`/api/estimate/history/${result.estimationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sections: editableSections,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Failed to save estimation changes")
      }

      setLaunchSuccess("Estimation changes saved successfully.")
      void fetchHistory()
    } catch (error: unknown) {
      const err = error as ErrorWithMessage
      setUploadError(err.message || "Failed to save estimation changes.")
    } finally {
      setIsSavingEstimation(false)
    }
  }

  const handleLaunchProject = async () => {
    if (!result?.estimationId) {
      setLaunchError("No saved estimation found. Upload a file again before launching.")
      return
    }

    if (!launchForm.projectName.trim() || !launchForm.clientName.trim() || !launchForm.address.trim()) {
      setLaunchError("Project name, client name, and address are required.")
      return
    }
    if (launchForm.clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(launchForm.clientEmail.trim())) {
      setLaunchError("Client email format is invalid.")
      return
    }

    setIsLaunching(true)
    setLaunchError(null)
    setLaunchSuccess(null)

    try {
      const launchRes = await fetch("/api/estimate/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estimationId: result.estimationId,
          projectName: launchForm.projectName.trim(),
          clientName: launchForm.clientName.trim(),
          clientEmail: launchForm.clientEmail.trim() || undefined,
          address: launchForm.address.trim(),
          type: launchForm.type.trim(),
          startDate: launchForm.startDate,
          budgetMode: launchForm.budgetMode,
        }),
      })

      const launchData = await launchRes.json()
      if (!launchRes.ok) {
        throw new Error(launchData.details || launchData.error || "Failed to launch project")
      }

      const created = launchData as LaunchResponse
      localStorage.setItem(`gantt-activities-${created.projectId}`, JSON.stringify(created.schedule || []))
      window.dispatchEvent(new Event("scheduler-update"))

      const budgetVersionRes = await fetch("/api/budget-version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: created.projectId,
          estimationId: result.estimationId,
          isRevision: false,
          source: `AI Launch: ${fileName || "Uploaded BOQ"}`,
        }),
      })

      if (!budgetVersionRes.ok) {
        const err = await budgetVersionRes.json()
        throw new Error(err.details || err.error || "Project created, but budget version failed")
      }

      await fetch("/api/budget-engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: created.projectId,
          estimationId: result.estimationId,
        }),
      })

      setLaunchSuccess(`${created.projectName} created successfully. Redirecting to project workspace...`)
      setTimeout(() => {
        router.push(`/projects/${created.projectId}?tab=overview`)
      }, 900)
    } catch (error) {
      const err = error as ErrorWithMessage
      setLaunchError(err.message || "Failed to launch project from estimation")
    } finally {
      setIsLaunching(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <TopNav />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">AI Cost Estimation Hub</h1>
            <p className="text-slate-500">
              Upload BOQ, architectural drawings, or specifications for AI-powered quantity surveying
            </p>
          </div>
          {result && (
            <div className="flex gap-2">
              <button
                onClick={handleSaveEstimation}
                disabled={isSavingEstimation || !result.estimationId}
                className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4 text-blue-600" />
                {isSavingEstimation ? "Saving..." : "Save Estimation"}
              </button>
              <button
                onClick={() => handleExport("excel")}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Export Excel
              </button>
              <button
                onClick={() => handleExport("pdf")}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Export PDF
              </button>
            </div>
          )}
        </div>

        {/* Upload Section */}
        <UploadZone onFileSelect={handleFileSelect} isUploading={isUploading} />

        {/* Past Estimations */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <History className="w-5 h-5 text-slate-600" />
              Past Estimations
            </h3>
            <button
              onClick={() => void fetchHistory()}
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Refresh
            </button>
          </div>

          {isLoadingHistory ? (
            <p className="text-sm text-slate-500">Loading saved estimations...</p>
          ) : historyError ? (
            <p className="text-sm text-red-600">{historyError}</p>
          ) : historyItems.length === 0 ? (
            <p className="text-sm text-slate-500">
              No past estimations yet. Upload a BOQ file to create one.
            </p>
          ) : (
            <div className="space-y-2">
              {historyItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.fileName}</p>
                    <p className="text-xs text-slate-500">
                      {item.location} · {new Date(item.createdAt).toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">{item.grandTotalLabel}</p>
                      <p className="text-xs text-slate-500">
                        Confidence {item.confidenceScore ?? 0}%
                      </p>
                    </div>
                    <button
                      onClick={() => void loadFromHistory(item.id)}
                      disabled={loadingHistoryId === item.id}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {loadingHistoryId === item.id ? "Loading..." : "Load"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upload Error */}
        {uploadError && (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-medium">Analysis Failed</p>
              <p className="text-sm">{uploadError}</p>
            </div>
          </div>
        )}

        {/* === RESULTS === */}
        {result && (
          <>
            {/* Project Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-blue-100">
                    <Ruler className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Built-up Area</p>
                    <p className="text-lg font-bold text-slate-900">
                      {result.project_summary?.built_up_area || "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-emerald-100">
                    <IndianRupee className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Cost / sqft</p>
                    <p className="text-lg font-bold text-slate-900">
                      {result.project_summary?.estimated_cost_per_sft || "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-indigo-100">
                    <Building2 className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Grand Total</p>
                    <p className="text-lg font-bold text-slate-900">{formatINR(grandTotal)}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-purple-100">
                    <Cpu className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider">AI Confidence</p>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-bold text-slate-900">
                        {result.confidence_score}%
                      </p>
                      <TrendingUp className="w-4 h-4 text-emerald-500" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Insights */}
            {result.insights && result.insights.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">AI Strategic Insights</h3>
                  <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-600 rounded-full">
                    Gemini 1.5 Pro
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {result.insights.map((insight, idx) => (
                    <div
                      key={idx}
                      className="flex gap-3 items-start p-3 bg-gradient-to-br from-slate-50 to-indigo-50/30 rounded-lg border border-slate-100"
                    >
                      <AlertCircle className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-slate-700">{insight}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Launch Studio */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                    <Rocket className="w-5 h-5 text-blue-600" />
                    Project Launch Studio
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Create a live project from this AI summary with today&apos;s date, generated timeline, and budget version.
                  </p>
                </div>
                <div className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                  End-to-end setup
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Project Name</label>
                  <input
                    value={launchForm.projectName}
                    onChange={(e) => setLaunchForm((prev) => ({ ...prev, projectName: e.target.value }))}
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    placeholder="Project name"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Client Name</label>
                  <input
                    value={launchForm.clientName}
                    onChange={(e) => setLaunchForm((prev) => ({ ...prev, clientName: e.target.value }))}
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    placeholder="Client name"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Client Email (for login mapping)</label>
                  <input
                    value={launchForm.clientEmail}
                    onChange={(e) => setLaunchForm((prev) => ({ ...prev, clientEmail: e.target.value }))}
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    placeholder="client@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Start Date</label>
                  <div className="relative">
                    <CalendarDays className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="date"
                      value={launchForm.startDate}
                      onChange={(e) => setLaunchForm((prev) => ({ ...prev, startDate: e.target.value }))}
                      className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    />
                  </div>
                </div>
                <div className="space-y-1.5 lg:col-span-2">
                  <label className="text-sm font-medium text-slate-700">Site Address</label>
                  <input
                    value={launchForm.address}
                    onChange={(e) => setLaunchForm((prev) => ({ ...prev, address: e.target.value }))}
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    placeholder="Project address"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Project Type</label>
                  <input
                    value={launchForm.type}
                    onChange={(e) => setLaunchForm((prev) => ({ ...prev, type: e.target.value }))}
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    placeholder="Residential / Commercial"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setLaunchForm((prev) => ({ ...prev, budgetMode: "lean" }))}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${launchForm.budgetMode === "lean" ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                >
                  <p className="text-sm font-semibold text-slate-900">Lean</p>
                  <p className="text-xs text-slate-500">Low market range + 5% contingency</p>
                </button>
                <button
                  type="button"
                  onClick={() => setLaunchForm((prev) => ({ ...prev, budgetMode: "balanced" }))}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${launchForm.budgetMode === "balanced" ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                >
                  <p className="text-sm font-semibold text-slate-900">Balanced</p>
                  <p className="text-xs text-slate-500">Medium market range + 10% contingency</p>
                </button>
                <button
                  type="button"
                  onClick={() => setLaunchForm((prev) => ({ ...prev, budgetMode: "premium" }))}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${launchForm.budgetMode === "premium" ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                >
                  <p className="text-sm font-semibold text-slate-900">Premium</p>
                  <p className="text-xs text-slate-500">Premium range + 15% contingency</p>
                </button>
              </div>

              {launchError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {launchError}
                </div>
              )}
              {launchSuccess && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {launchSuccess}
                </div>
              )}

              <div className="flex items-center justify-between gap-4 pt-1">
                <p className="text-xs text-slate-500">
                  This will create project details, auto-generate timeline milestones, create budget version, and run AI budget analysis.
                </p>
                <button
                  type="button"
                  onClick={handleLaunchProject}
                  disabled={isLaunching || !result.estimationId}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Rocket className="w-4 h-4" />
                  {isLaunching ? "Launching Workspace..." : "Launch Project Workspace"}
                </button>
              </div>
            </div>

            {/* BOQ Table — The Main Feature */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Bill of Quantities</h2>
                  <p className="text-sm text-slate-500">
                    {editableSections.length} sections · Click any rate to edit · Totals auto-recalculate
                  </p>
                </div>
                <span className="px-3 py-1.5 text-xs font-medium bg-blue-100 text-blue-600 rounded-full">
                  CPWD / SOR 2025
                </span>
              </div>
              <BOQTable
                sections={editableSections}
                onRateChange={handleRateChange}
                editable={true}
              />
            </div>

            {/* Risk Flags */}
            {result.risk_flags && result.risk_flags.length > 0 && (
              <RiskFlags flags={result.risk_flags} />
            )}

            {/* Market Range */}
            {result.market_range && (
              <MarketRangeCard range={result.market_range} currentTotal={grandTotal} />
            )}

            {/* Cost Breakdown + Summary Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Treemap */}
              {result.treemapData && result.treemapData.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Cost Breakdown Treemap</h3>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <Treemap
                        data={result.treemapData}
                        dataKey="size"
                        aspectRatio={4 / 3}
                        content={<CustomizedContent />}
                      >
                        <Tooltip
                          formatter={(value) => formatINR(Number(value ?? 0))}
                          contentStyle={{
                            backgroundColor: "white",
                            borderRadius: "8px",
                            border: "1px solid #e2e8f0",
                            color: "#0f172a",
                          }}
                        />
                      </Treemap>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Summary */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Estimation Summary</h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600">
                      <IndianRupee className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <span className="text-sm text-slate-500">Grand Total (Edited)</span>
                      <span className="text-2xl font-bold text-slate-900 block">
                        {formatINR(grandTotal)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
                    <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600">
                      <Cpu className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <span className="text-sm text-slate-500">AI Confidence Score</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-bold text-slate-900">
                          {result.confidence_score}%
                        </span>
                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
                    <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600">
                      <FileText className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <span className="text-sm text-slate-500">Source Document</span>
                      <span className="text-sm font-medium text-slate-900 block truncate">
                        {fileName || "N/A"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
                    <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center text-amber-600">
                      <MapPin className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <span className="text-sm text-slate-500">Location & Standards</span>
                      <span className="text-sm font-medium text-slate-900 block">
                        {result.project_summary?.location || "India"} · CPWD SOR 2025
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={() => handleExport("pdf")}
                      className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                    >
                      Generate Report
                    </button>
                    <button
                      onClick={() => handleExport("excel")}
                      className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium rounded-lg transition-colors"
                    >
                      Export Excel
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Section-wise Category Cards */}
            {result.categories && result.categories.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">Category Overview</h3>
                  <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-600 rounded-full">
                    AI Analyzed
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {result.categories.map((cat, index) => (
                    <div
                      key={index}
                      className="bg-slate-50 rounded-lg p-4 border-l-4"
                      style={{ borderLeftColor: cat.color }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold text-slate-900">{cat.name}</h4>
                          <p className="text-sm text-slate-500">{cat.cost}</p>
                        </div>
                        <span className="text-2xl font-bold text-slate-900">{cat.percent}%</span>
                      </div>
                      <div className="mt-2 h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${cat.percent}%`, backgroundColor: cat.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
