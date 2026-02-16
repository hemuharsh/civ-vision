"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { SchedulerActivity } from "@/types/scheduler"
import { calculateSchedule } from "@/lib/scheduler-engine"
import { derivePredecessorsFromDependencies, normalizeActivityDependencies } from "@/lib/scheduler-dependencies"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { 
    CheckCircle2, 
    Clock, 
    AlertTriangle, 
    Play, 
    Plus, 
    Pencil, 
    Trash2, 
    GripVertical,
    X,
    Save,
    AlertCircle
} from "lucide-react"

// Default activities for demonstration
const DEFAULT_ACTIVITIES: SchedulerActivity[] = [
    { id: "A1", name: "Site Preparation", duration: 5, predecessors: [], status: "COMPLETED" },
    { id: "A2", name: "Excavation", duration: 8, predecessors: ["A1"], status: "COMPLETED" },
    { id: "A3", name: "Foundation Pouring", duration: 10, predecessors: ["A2"], status: "IN_PROGRESS" },
    { id: "A4", name: "Curing Period", duration: 14, predecessors: ["A3"], status: "NOT_STARTED" },
    { id: "A5", name: "Structural Steel", duration: 12, predecessors: ["A4"], status: "NOT_STARTED" },
    { id: "A6", name: "Electrical Rough-In", duration: 7, predecessors: ["A5"], status: "NOT_STARTED" },
    { id: "A7", name: "Plumbing Rough-In", duration: 7, predecessors: ["A5"], status: "NOT_STARTED" },
    { id: "A8", name: "HVAC Installation", duration: 10, predecessors: ["A6", "A7"], status: "NOT_STARTED" },
    { id: "A9", name: "Drywall & Interior", duration: 15, predecessors: ["A8"], status: "NOT_STARTED" },
    { id: "A10", name: "Final Inspection", duration: 3, predecessors: ["A9"], status: "NOT_STARTED" },
]

const CURRENT_PROJECT_DAY = 18 // Simulated current day
const DAY_WIDTH = 32 // Width of each day column in pixels

interface GanttChartProps {
    projectId?: string
}

// Toast notification component
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
    useEffect(() => {
        const timer = setTimeout(onClose, 4000)
        return () => clearTimeout(timer)
    }, [onClose])

    return (
        <div className={cn(
            "fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg animate-in slide-in-from-bottom-5",
            type === 'success' ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
        )}>
            {type === 'success' ? (
                <CheckCircle2 className="h-5 w-5" />
            ) : (
                <AlertCircle className="h-5 w-5" />
            )}
            <span className="font-medium">{message}</span>
            <button onClick={onClose} className="ml-2 hover:opacity-70">
                <X className="h-4 w-4" />
            </button>
        </div>
    )
}

// Activity Form Modal
interface ActivityFormData {
    name: string
    duration: number
    predecessors: string[]
    status: SchedulerActivity["status"]
    isCriticalOverride: boolean
    notes: string
    manualStart: string
}

const defaultFormData: ActivityFormData = {
    name: "",
    duration: 1,
    predecessors: [],
    status: "NOT_STARTED",
    isCriticalOverride: false,
    notes: "",
    manualStart: ""
}

export function GanttChart({ projectId }: GanttChartProps) {
    // Load from localStorage or use defaults
    const getInitialActivities = useCallback(() => {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem(`gantt-activities-${projectId || 'default'}`)
            if (stored) {
                try {
                    return JSON.parse(stored)
                } catch {
                    return DEFAULT_ACTIVITIES
                }
            }
        }
        return DEFAULT_ACTIVITIES
    }, [projectId])

    const [activities, setActivities] = useState<SchedulerActivity[]>([])
    const [selectedActivity, setSelectedActivity] = useState<SchedulerActivity | null>(null)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingActivity, setEditingActivity] = useState<SchedulerActivity | null>(null)
    const [formData, setFormData] = useState<ActivityFormData>(defaultFormData)
    const [formErrors, setFormErrors] = useState<Record<string, string>>({})
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
    
    // Drag state
    const [dragging, setDragging] = useState<{
        activityId: string
        type: 'move' | 'resize-start' | 'resize-end'
        startX: number
        originalStart: number
        originalDuration: number
    } | null>(null)

    // Initialize activities on mount and listen for updates
    useEffect(() => {
        const loadActivities = () => setActivities(getInitialActivities())
        
        loadActivities()

        // Listen for updates from other components
        const handleUpdate = () => {
            console.log("Received scheduler update event")
            loadActivities()
        }

        window.addEventListener('scheduler-update', handleUpdate)
        return () => window.removeEventListener('scheduler-update', handleUpdate)
    }, [getInitialActivities])

    // Persist to localStorage
    useEffect(() => {
        if (activities.length > 0 && typeof window !== 'undefined') {
            localStorage.setItem(`gantt-activities-${projectId || 'default'}`, JSON.stringify(activities))
        }
    }, [activities, projectId])

    // Calculate schedule using CPM
    const scheduledActivities = useMemo(() => calculateSchedule(activities), [activities])
    
    // Calculate project metrics
    const projectDuration = useMemo(() => {
        return Math.max(...scheduledActivities.map(a => a.endDay || 0), 30) // Min 30 days for display
    }, [scheduledActivities])

    const completedCount = scheduledActivities.filter(a => a.status === "COMPLETED").length
    const criticalCount = scheduledActivities.filter(a => a.isCritical).length
    const progress = scheduledActivities.length > 0 
        ? Math.round((completedCount / scheduledActivities.length) * 100) 
        : 0

    // Generate day columns
    const dayColumns = useMemo(() => {
        const cols = []
        for (let i = 1; i <= projectDuration; i++) {
            cols.push(i)
        }
        return cols
    }, [projectDuration])

    // Show toast notification
    const showToast = useCallback((message: string, type: 'success' | 'error') => {
        setToast({ message, type })
    }, [])

    // Generate unique ID
    const generateId = () => {
        const maxNum = activities.reduce((max, a) => {
            const num = parseInt(a.id.replace(/\D/g, '')) || 0
            return Math.max(max, num)
        }, 0)
        return `A${maxNum + 1}`
    }

    // Open modal for new activity
    const openNewActivityModal = () => {
        setEditingActivity(null)
        setFormData(defaultFormData)
        setFormErrors({})
        setIsModalOpen(true)
    }

    // Open modal for editing
    const openEditModal = (activity: SchedulerActivity) => {
        setEditingActivity(activity)
        setFormData({
            name: activity.name,
            duration: activity.duration,
            predecessors: derivePredecessorsFromDependencies(normalizeActivityDependencies(activity)),
            status: activity.status,
            isCriticalOverride: activity.isCritical || false,
            notes: activity.notes || "",
            manualStart: activity.manualStart?.toString() || ""
        })
        setFormErrors({})
        setIsModalOpen(true)
    }

    // Validate form
    const validateForm = (): boolean => {
        const errors: Record<string, string> = {}
        
        if (!formData.name.trim()) {
            errors.name = "Activity name is required"
        }
        
        if (formData.duration < 1) {
            errors.duration = "Duration must be at least 1 day"
        }

        if (formData.manualStart && parseInt(formData.manualStart) < 1) {
            errors.manualStart = "Start day must be at least 1"
        }

        // Check for circular dependencies
        if (editingActivity) {
            const wouldCreateCycle = formData.predecessors.includes(editingActivity.id)
            if (wouldCreateCycle) {
                errors.predecessors = "Activity cannot be its own predecessor"
            }
        }

        setFormErrors(errors)
        return Object.keys(errors).length === 0
    }

    // Save activity
    const handleSave = () => {
        if (!validateForm()) {
            showToast("Please fix the form errors", "error")
            return
        }

        const activityData: SchedulerActivity = {
            id: editingActivity?.id || generateId(),
            name: formData.name.trim(),
            duration: formData.duration,
            predecessors: formData.predecessors,
            dependencies: formData.predecessors.map((activityId) => ({
                activityId,
                type: "FS",
                lagDays: 0
            })),
            status: formData.status,
            notes: formData.notes || undefined,
            manualStart: formData.manualStart ? parseInt(formData.manualStart) : undefined,
            isCritical: formData.isCriticalOverride || undefined
        }

        if (editingActivity) {
            // Update existing
            setActivities(prev => prev.map(a => 
                a.id === editingActivity.id ? activityData : a
            ))
            showToast("Activity Updated Successfully", "success")
        } else {
            // Add new
            setActivities(prev => [...prev, activityData])
            showToast("Activity Added Successfully", "success")
        }

        setIsModalOpen(false)
        setSelectedActivity(null)
    }

    // Delete activity
    const handleDelete = (activityId: string) => {
        // Check if other activities depend on this one
        const dependents = activities.filter(a =>
            normalizeActivityDependencies(a).some(dep => dep.activityId === activityId)
        )
        
        if (dependents.length > 0) {
            // Remove the dependency from dependents
            setActivities(prev => prev
                .filter(a => a.id !== activityId)
                .map(a => {
                    const remainingDependencies = normalizeActivityDependencies(a)
                        .filter(dep => dep.activityId !== activityId)
                    return {
                        ...a,
                        dependencies: remainingDependencies,
                        predecessors: derivePredecessorsFromDependencies(remainingDependencies),
                    }
                })
            )
        } else {
            setActivities(prev => prev.filter(a => a.id !== activityId))
        }
        
        showToast("Activity Deleted", "success")
        setDeleteConfirm(null)
        setSelectedActivity(null)
    }

    // Handle status change
    const handleStatusChange = (activityId: string, newStatus: SchedulerActivity["status"]) => {
        setActivities(prev => prev.map(a => 
            a.id === activityId ? { ...a, status: newStatus } : a
        ))
        showToast(`Activity marked as ${newStatus.replace('_', ' ').toLowerCase()}`, "success")
    }

    // Check if activity can start (all predecessors completed)
    const canStart = (activity: SchedulerActivity) => {
        if (activity.status !== "NOT_STARTED") return false
        return normalizeActivityDependencies(activity).every(dep => {
            const predecessor = scheduledActivities.find(a => a.id === dep.activityId)
            if (!predecessor) return true

            if (dep.type === "FS" || dep.type === "FF") {
                return predecessor.status === "COMPLETED"
            }

            // SS/SF: successor can start once predecessor has started.
            return predecessor.status === "IN_PROGRESS" || predecessor.status === "COMPLETED"
        })
    }

    // Drag handlers for bar manipulation
    const handleMouseDown = (e: React.MouseEvent, activity: SchedulerActivity, type: 'move' | 'resize-end') => {
        e.preventDefault()
        e.stopPropagation()
        
        const scheduled = scheduledActivities.find(a => a.id === activity.id)
        if (!scheduled) return

        setDragging({
            activityId: activity.id,
            type,
            startX: e.clientX,
            originalStart: scheduled.startDay || 1,
            originalDuration: activity.duration
        })
    }

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!dragging) return

        const deltaX = e.clientX - dragging.startX
        const deltaDays = Math.round(deltaX / DAY_WIDTH)

        setActivities(prev => prev.map(a => {
            if (a.id !== dragging.activityId) return a

            if (dragging.type === 'move') {
                const newStart = Math.max(1, dragging.originalStart + deltaDays)
                return { ...a, manualStart: newStart }
            } else if (dragging.type === 'resize-end') {
                const newDuration = Math.max(1, dragging.originalDuration + deltaDays)
                return { ...a, duration: newDuration }
            }
            return a
        }))
    }, [dragging])

    const handleMouseUp = useCallback(() => {
        if (dragging) {
            showToast("Activity Updated Successfully", "success")
        }
        setDragging(null)
    }, [dragging, showToast])

    // Attach global mouse listeners for drag
    useEffect(() => {
        if (dragging) {
            window.addEventListener('mousemove', handleMouseMove)
            window.addEventListener('mouseup', handleMouseUp)
            return () => {
                window.removeEventListener('mousemove', handleMouseMove)
                window.removeEventListener('mouseup', handleMouseUp)
            }
        }
    }, [dragging, handleMouseMove, handleMouseUp])

    // Get available predecessors for the form
    const getAvailablePredecessors = () => {
        return activities.filter(a => {
            // Can't be predecessor of itself
            if (editingActivity && a.id === editingActivity.id) return false
            return true
        })
    }

    return (
        <div className="space-y-6">
            {/* Toast Notifications */}
            {toast && (
                <Toast 
                    message={toast.message} 
                    type={toast.type} 
                    onClose={() => setToast(null)} 
                />
            )}

            {/* Project Metrics */}
            <div className="grid grid-cols-4 gap-4">
                <Card className="bg-white border-slate-200">
                    <CardContent className="p-4">
                        <div className="text-sm text-slate-500">Project Progress</div>
                        <div className="text-2xl font-bold text-slate-900">{progress}%</div>
                        <div className="text-xs text-slate-400">{completedCount} of {scheduledActivities.length} activities</div>
                    </CardContent>
                </Card>
                <Card className="bg-white border-slate-200">
                    <CardContent className="p-4">
                        <div className="text-sm text-slate-500">Current Day</div>
                        <div className="text-2xl font-bold text-blue-600">Day {CURRENT_PROJECT_DAY}</div>
                        <div className="text-xs text-slate-400">of {projectDuration} total days</div>
                    </CardContent>
                </Card>
                <Card className="bg-white border-slate-200">
                    <CardContent className="p-4">
                        <div className="text-sm text-slate-500">Critical Activities</div>
                        <div className="text-2xl font-bold text-red-600">{criticalCount}</div>
                        <div className="text-xs text-slate-400">Zero float tasks</div>
                    </CardContent>
                </Card>
                <Card className="bg-white border-slate-200">
                    <CardContent className="p-4">
                        <div className="text-sm text-slate-500">Duration</div>
                        <div className="text-2xl font-bold text-slate-900">{projectDuration} Days</div>
                        <div className="text-xs text-slate-400">Estimated completion</div>
                    </CardContent>
                </Card>
            </div>

            {/* Gantt Chart */}
            <Card className="bg-white border-slate-200 overflow-hidden">
                <CardHeader className="border-b border-slate-100 bg-slate-50 flex flex-row items-center justify-between">
                    <CardTitle className="text-slate-900 flex items-center gap-2">
                        <Clock className="h-5 w-5 text-blue-600" />
                        Project Schedule (Gantt Chart)
                    </CardTitle>
                    <Button 
                        onClick={openNewActivityModal}
                        className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                    >
                        <Plus className="h-4 w-4" />
                        Add Activity
                    </Button>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <div className="min-w-[1200px]">
                            {/* Header Row */}
                            <div className="flex border-b border-slate-200 bg-slate-50">
                                <div className="w-64 flex-shrink-0 px-4 py-2 font-medium text-slate-700 border-r border-slate-200">
                                    Activity
                                </div>
                                <div className="w-20 flex-shrink-0 px-2 py-2 font-medium text-slate-700 text-center border-r border-slate-200">
                                    Duration
                                </div>
                                <div className="w-16 flex-shrink-0 px-2 py-2 font-medium text-slate-700 text-center border-r border-slate-200">
                                    Actions
                                </div>
                                <div className="flex-1 flex">
                                    {dayColumns.map(day => (
                                        <div 
                                            key={day} 
                                            className={cn(
                                                "w-8 flex-shrink-0 text-xs text-center py-2 border-r border-slate-100",
                                                day === CURRENT_PROJECT_DAY && "bg-blue-100 font-bold text-blue-700"
                                            )}
                                        >
                                            {day}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Activity Rows */}
                            {scheduledActivities.map((activity) => (
                                <div 
                                    key={activity.id}
                                    className={cn(
                                        "flex border-b border-slate-100 hover:bg-slate-50 transition-colors",
                                        selectedActivity?.id === activity.id && "bg-blue-50"
                                    )}
                                >
                                    {/* Activity Name */}
                                    <div 
                                        className="w-64 flex-shrink-0 px-4 py-3 border-r border-slate-200 cursor-pointer"
                                        onClick={() => setSelectedActivity(activity)}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono text-slate-400">{activity.id}</span>
                                            <span className="text-sm font-medium text-slate-900 truncate">{activity.name}</span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge 
                                                variant="secondary" 
                                                className={cn(
                                                    "text-[10px]",
                                                    activity.status === "COMPLETED" && "bg-green-100 text-green-700",
                                                    activity.status === "IN_PROGRESS" && "bg-blue-100 text-blue-700",
                                                    activity.status === "NOT_STARTED" && "bg-slate-100 text-slate-500"
                                                )}
                                            >
                                                {activity.status.replace("_", " ")}
                                            </Badge>
                                            {activity.isCritical && (
                                                <Badge variant="destructive" className="text-[10px] bg-red-600">
                                                    CRITICAL
                                                </Badge>
                                            )}
                                        </div>
                                    </div>

                                    {/* Duration */}
                                    <div className="w-20 flex-shrink-0 px-2 py-3 text-center text-sm text-slate-600 border-r border-slate-200">
                                        {activity.duration}d
                                    </div>

                                    {/* Actions */}
                                    <div className="w-16 flex-shrink-0 px-1 py-2 flex items-center justify-center gap-1 border-r border-slate-200">
                                        <button 
                                            onClick={() => openEditModal(activity)}
                                            className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-blue-600 transition-colors"
                                            title="Edit activity"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button 
                                            onClick={() => setDeleteConfirm(activity.id)}
                                            className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-red-600 transition-colors"
                                            title="Delete activity"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>

                                    {/* Timeline Bar */}
                                    <div className="flex-1 flex relative py-2">
                                        {/* Day grid lines */}
                                        {dayColumns.map(day => (
                                            <div 
                                                key={day} 
                                                className={cn(
                                                    "w-8 flex-shrink-0 border-r border-slate-50",
                                                    day === CURRENT_PROJECT_DAY && "bg-blue-50"
                                                )}
                                            />
                                        ))}
                                        
                                        {/* Dependency arrows (draw before bars so they appear behind) */}
                                        <svg className="absolute inset-0 pointer-events-none overflow-visible" style={{ zIndex: 1 }}>
                                            {normalizeActivityDependencies(activity).map((dependency, idx) => {
                                                const pred = scheduledActivities.find(a => a.id === dependency.activityId)
                                                if (!pred) return null
                                                
                                                const predecessorX = dependency.type === "SS" || dependency.type === "SF"
                                                    ? ((pred.startDay || 1) - 1) * DAY_WIDTH
                                                    : (pred.endDay || 1) * DAY_WIDTH
                                                const successorX = dependency.type === "FF" || dependency.type === "SF"
                                                    ? (activity.endDay || 1) * DAY_WIDTH
                                                    : ((activity.startDay || 1) - 1) * DAY_WIDTH
                                                const rowHeight = 44 // Approximate row height
                                                const predIndex = scheduledActivities.findIndex(a => a.id === dependency.activityId)
                                                const actIndex = scheduledActivities.findIndex(a => a.id === activity.id)
                                                const yDiff = (actIndex - predIndex) * rowHeight
                                                
                                                return (
                                                    <path
                                                        key={`${dependency.activityId}-${dependency.type}-${idx}`}
                                                        d={`M ${predecessorX} ${-yDiff + 22} 
                                                            L ${predecessorX + 8} ${-yDiff + 22} 
                                                            L ${predecessorX + 8} 22
                                                            L ${successorX} 22`}
                                                        fill="none"
                                                        stroke={activity.isCritical ? "#dc2626" : "#94a3b8"}
                                                        strokeWidth="1.5"
                                                        strokeDasharray={activity.isCritical ? "0" : "4,2"}
                                                        markerEnd="url(#arrowhead)"
                                                    />
                                                )
                                            })}
                                            <defs>
                                                <marker
                                                    id="arrowhead"
                                                    markerWidth="6"
                                                    markerHeight="6"
                                                    refX="5"
                                                    refY="3"
                                                    orient="auto"
                                                >
                                                    <path d="M 0 0 L 6 3 L 0 6 z" fill="#94a3b8" />
                                                </marker>
                                            </defs>
                                        </svg>

                                        {/* Activity Bar */}
                                        <div 
                                            className={cn(
                                                "absolute top-1/2 -translate-y-1/2 h-6 rounded-sm flex items-center justify-between text-xs font-medium text-white shadow-sm group",
                                                dragging?.activityId === activity.id && "opacity-70",
                                                activity.isCritical && "bg-red-500",
                                                !activity.isCritical && activity.status === "COMPLETED" && "bg-green-500",
                                                !activity.isCritical && activity.status === "IN_PROGRESS" && "bg-blue-500",
                                                !activity.isCritical && activity.status === "NOT_STARTED" && "bg-slate-400"
                                            )}
                                            style={{
                                                left: `${((activity.startDay || 1) - 1) * DAY_WIDTH}px`,
                                                width: `${activity.duration * DAY_WIDTH - 4}px`,
                                                zIndex: dragging?.activityId === activity.id ? 10 : 2,
                                                cursor: dragging ? 'grabbing' : 'grab'
                                            }}
                                            onMouseDown={(e) => handleMouseDown(e, activity, 'move')}
                                        >
                                            {/* Move handle */}
                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity pl-1">
                                                <GripVertical className="h-3 w-3" />
                                            </div>
                                            
                                            {/* Activity name */}
                                            <span className="flex-1 text-center truncate px-1">
                                                {activity.duration > 3 ? activity.name.substring(0, 12) : ''}
                                            </span>
                                            
                                            {/* Resize handle */}
                                            <div 
                                                className="w-2 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity bg-white/30 rounded-r-sm"
                                                onMouseDown={(e) => {
                                                    e.stopPropagation()
                                                    handleMouseDown(e, activity, 'resize-end')
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Empty state */}
                            {scheduledActivities.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                    <Clock className="h-12 w-12 mb-4" />
                                    <p className="text-lg font-medium mb-2">No activities yet</p>
                                    <p className="text-sm mb-4">Get started by adding your first activity</p>
                                    <Button onClick={openNewActivityModal} className="gap-2">
                                        <Plus className="h-4 w-4" />
                                        Add Activity
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Activity Details Panel */}
            {selectedActivity && !isModalOpen && (
                <Card className="bg-white border-slate-200">
                    <CardHeader className="border-b border-slate-100">
                        <CardTitle className="text-slate-900 flex items-center justify-between">
                            <span>Activity Details: {selectedActivity.name}</span>
                            <div className="flex gap-2">
                                <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => openEditModal(selectedActivity)}
                                    className="gap-1"
                                >
                                    <Pencil className="h-3 w-3" />
                                    Edit
                                </Button>
                                <Button 
                                    variant="ghost" 
                                    size="sm"
                                    onClick={() => setSelectedActivity(null)}
                                >
                                    Close
                                </Button>
                            </div>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <h4 className="text-sm font-medium text-slate-500 mb-2">Schedule</h4>
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-slate-600">Start Day:</span>
                                        <span className="font-medium text-slate-900">Day {selectedActivity.startDay}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-600">End Day:</span>
                                        <span className="font-medium text-slate-900">Day {selectedActivity.endDay}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-600">Duration:</span>
                                        <span className="font-medium text-slate-900">{selectedActivity.duration} days</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-600">Total Float:</span>
                                        <span className={cn(
                                            "font-medium",
                                            selectedActivity.totalFloat === 0 ? "text-red-600" : "text-green-600"
                                        )}>
                                            {selectedActivity.totalFloat} days
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <h4 className="text-sm font-medium text-slate-500 mb-2">Dependencies</h4>
                                <div className="space-y-2 text-sm">
                                    <div>
                                        <span className="text-slate-600">Predecessors: </span>
                                        {normalizeActivityDependencies(selectedActivity).length > 0 
                                            ? normalizeActivityDependencies(selectedActivity).map(dep => {
                                                const pred = activities.find(a => a.id === dep.activityId)
                                                const label = pred ? `${dep.activityId} (${pred.name})` : dep.activityId
                                                const lag = dep.lagDays ? `, lag ${dep.lagDays}d` : ""
                                                return `${label} [${dep.type}${lag}]`
                                            }).join(", ")
                                            : <span className="text-slate-400">None (Start Activity)</span>
                                        }
                                    </div>
                                    <div>
                                        <span className="text-slate-600">Successors: </span>
                                        {scheduledActivities
                                            .filter(a => normalizeActivityDependencies(a).some(dep => dep.activityId === selectedActivity.id))
                                            .map(a => `${a.id} (${a.name})`)
                                            .join(", ") || <span className="text-slate-400">None (End Activity)</span>
                                        }
                                    </div>
                                </div>
                                
                                {/* Actions */}
                                <div className="mt-4 pt-4 border-t border-slate-100">
                                    <h4 className="text-sm font-medium text-slate-500 mb-2">Actions</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedActivity.status === "NOT_STARTED" && canStart(selectedActivity) && (
                                            <Button 
                                                size="sm" 
                                                className="bg-blue-600 hover:bg-blue-700"
                                                onClick={() => handleStatusChange(selectedActivity.id, "IN_PROGRESS")}
                                            >
                                                <Play className="h-3 w-3 mr-1" /> Start Activity
                                            </Button>
                                        )}
                                        {selectedActivity.status === "NOT_STARTED" && !canStart(selectedActivity) && (
                                            <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                                                <AlertTriangle className="h-3 w-3 mr-1" /> Waiting for predecessors
                                            </Badge>
                                        )}
                                        {selectedActivity.status === "IN_PROGRESS" && (
                                            <Button 
                                                size="sm" 
                                                className="bg-green-600 hover:bg-green-700"
                                                onClick={() => handleStatusChange(selectedActivity.id, "COMPLETED")}
                                            >
                                                <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Complete
                                            </Button>
                                        )}
                                        {selectedActivity.status === "COMPLETED" && (
                                            <Badge variant="secondary" className="bg-green-100 text-green-700">
                                                <CheckCircle2 className="h-3 w-3 mr-1" /> Completed
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Notes */}
                        {selectedActivity.notes && (
                            <div className="mt-4 pt-4 border-t border-slate-100">
                                <h4 className="text-sm font-medium text-slate-500 mb-2">Notes</h4>
                                <p className="text-sm text-slate-700">{selectedActivity.notes}</p>
                            </div>
                        )}
                        
                        {/* Critical Path Warning */}
                        {selectedActivity.isCritical && (
                            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                                <div className="flex items-center gap-2 text-red-700">
                                    <AlertTriangle className="h-4 w-4" />
                                    <span className="font-medium">Critical Path Activity</span>
                                </div>
                                <p className="text-sm text-red-600 mt-1">
                                    Any delay in this activity will directly delay the entire project completion.
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Legend */}
            <div className="flex items-center gap-6 text-sm text-slate-600 bg-slate-50 rounded-lg p-4">
                <span className="font-medium">Legend:</span>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-red-500" />
                    <span>Critical Path</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-green-500" />
                    <span>Completed</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-blue-500" />
                    <span>In Progress</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-slate-400" />
                    <span>Not Started</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-500 bg-blue-100" />
                    <span>Current Day</span>
                </div>
                <div className="flex items-center gap-2 ml-auto text-xs text-slate-400">
                    <GripVertical className="h-3 w-3" />
                    <span>Drag bars to adjust schedule</span>
                </div>
            </div>

            {/* Activity Form Modal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="text-slate-900">
                            {editingActivity ? "Edit Activity" : "Add New Activity"}
                        </DialogTitle>
                        <DialogDescription>
                            {editingActivity 
                                ? "Modify the activity details below." 
                                : "Create a new activity for your project schedule."}
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-4">
                        {/* Activity Name */}
                        <div className="space-y-2">
                            <Label htmlFor="name" className="text-slate-700">
                                Activity Name <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="e.g., Foundation Pouring"
                                className={cn(formErrors.name && "border-red-500")}
                            />
                            {formErrors.name && (
                                <p className="text-xs text-red-500">{formErrors.name}</p>
                            )}
                        </div>

                        {/* Duration and Start */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="duration" className="text-slate-700">
                                    Duration (days) <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="duration"
                                    type="number"
                                    min="1"
                                    value={formData.duration}
                                    onChange={(e) => setFormData(prev => ({ 
                                        ...prev, 
                                        duration: Math.max(1, parseInt(e.target.value) || 1) 
                                    }))}
                                    className={cn(formErrors.duration && "border-red-500")}
                                />
                                {formErrors.duration && (
                                    <p className="text-xs text-red-500">{formErrors.duration}</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="manualStart" className="text-slate-700">
                                    Start Day <span className="text-slate-400">(optional)</span>
                                </Label>
                                <Input
                                    id="manualStart"
                                    type="number"
                                    min="1"
                                    value={formData.manualStart}
                                    onChange={(e) => setFormData(prev => ({ 
                                        ...prev, 
                                        manualStart: e.target.value 
                                    }))}
                                    placeholder="Auto-calculated"
                                    className={cn(formErrors.manualStart && "border-red-500")}
                                />
                                {formErrors.manualStart && (
                                    <p className="text-xs text-red-500">{formErrors.manualStart}</p>
                                )}
                            </div>
                        </div>

                        {/* Predecessors */}
                        <div className="space-y-2">
                            <Label className="text-slate-700">Predecessors</Label>
                            <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-lg min-h-[60px]">
                                {getAvailablePredecessors().map(activity => (
                                    <label key={activity.id} className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={formData.predecessors.includes(activity.id)}
                                            onChange={(e) => {
                                                setFormData(prev => ({
                                                    ...prev,
                                                    predecessors: e.target.checked
                                                        ? [...prev.predecessors, activity.id]
                                                        : prev.predecessors.filter(id => id !== activity.id)
                                                }))
                                            }}
                                            className="rounded border-slate-300 text-blue-600"
                                        />
                                        <span className="text-sm text-slate-700">
                                            {activity.id}: {activity.name}
                                        </span>
                                    </label>
                                ))}
                                {getAvailablePredecessors().length === 0 && (
                                    <span className="text-sm text-slate-400">No other activities available</span>
                                )}
                            </div>
                            {formErrors.predecessors && (
                                <p className="text-xs text-red-500">{formErrors.predecessors}</p>
                            )}
                        </div>

                        {/* Status */}
                        <div className="space-y-2">
                            <Label htmlFor="status" className="text-slate-700">Status</Label>
                            <select
                                id="status"
                                value={formData.status}
                                onChange={(e) => setFormData(prev => ({ 
                                    ...prev, 
                                    status: e.target.value as SchedulerActivity["status"] 
                                }))}
                                className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-slate-900 text-sm"
                            >
                                <option value="NOT_STARTED">Not Started</option>
                                <option value="IN_PROGRESS">In Progress</option>
                                <option value="COMPLETED">Completed</option>
                            </select>
                        </div>

                        {/* Critical Activity Toggle */}
                        <div className="flex items-center justify-between p-4 bg-red-50 border border-red-200 rounded-lg">
                            <div className="space-y-1">
                                <Label htmlFor="critical" className="text-red-700 font-medium">
                                    Critical Activity
                                </Label>
                                <p className="text-xs text-red-600">
                                    Delays to critical activities directly delay the project
                                </p>
                            </div>
                            <Switch
                                id="critical"
                                checked={formData.isCriticalOverride}
                                onCheckedChange={(checked) => setFormData(prev => ({ 
                                    ...prev, 
                                    isCriticalOverride: checked 
                                }))}
                            />
                        </div>

                        {/* Notes */}
                        <div className="space-y-2">
                            <Label htmlFor="notes" className="text-slate-700">Notes</Label>
                            <Textarea
                                id="notes"
                                value={formData.notes}
                                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                                placeholder="Add any additional notes about this activity..."
                                className="min-h-[80px]"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button 
                            variant="outline" 
                            onClick={() => setIsModalOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button 
                            onClick={handleSave}
                            className="bg-blue-600 hover:bg-blue-700 gap-2"
                        >
                            <Save className="h-4 w-4" />
                            {editingActivity ? "Save Changes" : "Add Activity"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle className="text-red-600 flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5" />
                            Delete Activity
                        </DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete this activity? This action cannot be undone.
                            {activities.some(a =>
                                normalizeActivityDependencies(a).some(dep => dep.activityId === (deleteConfirm || ''))
                            ) && (
                                <span className="block mt-2 text-amber-600">
                                    Note: Other activities depend on this one. Their dependencies will be updated.
                                </span>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button 
                            variant="outline" 
                            onClick={() => setDeleteConfirm(null)}
                        >
                            Cancel
                        </Button>
                        <Button 
                            variant="destructive"
                            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
                            className="gap-2"
                        >
                            <Trash2 className="h-4 w-4" />
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
