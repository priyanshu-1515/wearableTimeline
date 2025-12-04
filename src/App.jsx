import { useState, useMemo, useCallback } from 'react'
import { useDebounce } from 'use-debounce'
import Papa from 'papaparse'
import { parse, isAfter, addDays, parseISO } from 'date-fns'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
  Brush
} from 'recharts'
import { Upload, X, RefreshCw, HelpCircle, Calendar, ZoomIn, ZoomOut, Maximize2, Plus, Edit2, Trash2, AlertTriangle } from 'lucide-react'

// ===== CONSTANTS =====
const VERSION = 'v1.0'
const MERGE_THRESHOLD_SEC = 45
const MAX_EVENTS = 10

const ACTIVITY_TYPES = [
  'Exercise',
  'Sports',
  'Walking',
  'Running',
  'Jogging',
  'Cycling',
  'Swimming',
  'Yoga',
  'Stretching',
  'Breakfast',
  'Lunch',
  'Dinner',
  'Snack',
  'Work (Cognitive)',
  'Work (Physical)',
  'Meeting',
  'Reading',
  'Commute',
  'Driving',
  'Sleep',
  'Nap',
  'Rest',
  'Bath/Shower',
  'Gaming',
  'Social Activity',
  'Phone Call',
  'Video Call',
  'Meditation',
  'Other'
]

const COLOR_PALETTE = {
  distal: {
    skinT: '#ef4444',
    ambT: '#f97316',
    accX: '#84cc16',
    accY: '#22c55e',
    accZ: '#10b981',
    gyroX: '#14b8a6',
    gyroY: '#06b6d4',
    gyroZ: '#0ea5e9',
    hf: '#8b5cf6'
  },
  proximal: {
    skinT: '#dc2626',
    ambT: '#ea580c',
    accX: '#65a30d',
    accY: '#16a34a',
    accZ: '#059669',
    gyroX: '#0d9488',
    gyroY: '#0891b2',
    gyroZ: '#0284c7',
    hf: '#7c3aed'
  },
  dpg: '#ec4899',
  events: ['#fbbf24', '#a78bfa', '#fb7185', '#34d399', '#60a5fa', '#f472b6']
}

// ===== UTILITY FUNCTIONS =====

// Normalize header names (case-insensitive, trim, remove extra spaces)
function normalizeHeader(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\[\]]/g, '')
}

// Map parsed row to standard keys
function mapHeaders(row) {
  const mapped = {}
  Object.keys(row).forEach(key => {
    const normalized = normalizeHeader(key)
    
    // Time mapping
    if (normalized.includes('time') || normalized === 'time') {
      mapped.time = row[key]
    }
    // SkinT mapping
    else if (normalized.includes('skint')) {
      mapped.skinT = parseFloat(row[key]) || null
    }
    // Ambient mapping
    else if (normalized.includes('ambient') || normalized.includes('ambt')) {
      mapped.ambT = parseFloat(row[key]) || null
    }
    // Heart Flux mapping
    else if (normalized.includes('hf') || normalized.includes('heart flux')) {
      mapped.hf = parseFloat(row[key]) || null
    }
    // Accelerometer mappings
    else if (normalized.includes('acc') && normalized.includes('x')) {
      mapped.accX = parseFloat(row[key]) || null
    }
    else if (normalized.includes('acc') && normalized.includes('y')) {
      mapped.accY = parseFloat(row[key]) || null
    }
    else if (normalized.includes('acc') && normalized.includes('z')) {
      mapped.accZ = parseFloat(row[key]) || null
    }
    // Gyroscope mappings
    else if (normalized.includes('gyro') && normalized.includes('x')) {
      mapped.gyroX = parseFloat(row[key]) || null
    }
    else if (normalized.includes('gyro') && normalized.includes('y')) {
      mapped.gyroY = parseFloat(row[key]) || null
    }
    else if (normalized.includes('gyro') && normalized.includes('z')) {
      mapped.gyroZ = parseFloat(row[key]) || null
    }
    // Optional fields
    else if (normalized.includes('hr') || normalized.includes('heart rate')) {
      mapped.hr = parseFloat(row[key]) || null
    }
    else if (normalized.includes('spo2')) {
      mapped.spo2 = parseFloat(row[key]) || null
    }
  })
  return mapped
}

// Parse time value (ISO or HH:MM:SS)
function parseTimeValue(timeStr, baseDate) {
  if (!timeStr) return null
  
  // Try ISO format first
  try {
    const isoDate = parseISO(timeStr)
    if (!isNaN(isoDate.getTime())) {
      return isoDate
    }
  } catch (e) {
    // Continue to HH:MM:SS parsing
  }
  
  // Try HH:MM:SS format
  if (timeStr.match(/^\d{1,2}:\d{2}:\d{2}$/)) {
    if (!baseDate) {
      throw new Error('Base date required for HH:MM:SS format')
    }
    return parse(timeStr, 'HH:mm:ss', baseDate)
  }
  
  return null
}

// Apply midnight rollover detection
function applyMidnightRollover(samples) {
  if (samples.length === 0) return samples
  
  const result = [...samples]
  for (let i = 1; i < result.length; i++) {
    if (isAfter(result[i - 1].t, result[i].t)) {
      // Rollover detected - add 1 day to current and all subsequent
      for (let j = i; j < result.length; j++) {
        result[j].t = addDays(result[j].t, 1)
      }
    }
  }
  return result
}

// Parse CSV text
function parseCSV(text) {
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          reject(new Error(results.errors[0].message))
        } else {
          resolve(results.data)
        }
      },
      error: (error) => reject(error)
    })
  })
}

// Merge streams (±45s nearest neighbor)
function mergeStreams(distalSamples, proximalSamples) {
  const merged = []
  const usedProxIndices = new Set()
  
  distalSamples.forEach(dSample => {
    let nearestProx = null
    let nearestDelta = Infinity
    let nearestIdx = -1
    
    proximalSamples.forEach((pSample, idx) => {
      if (usedProxIndices.has(idx)) return
      
      const delta = Math.abs(pSample.t.getTime() - dSample.t.getTime()) / 1000
      if (delta <= MERGE_THRESHOLD_SEC && delta < nearestDelta) {
        nearestDelta = delta
        nearestProx = pSample
        nearestIdx = idx
      }
    })
    
    if (nearestIdx >= 0) {
      usedProxIndices.add(nearestIdx)
    }
    
    const dpg = (dSample.d.skinT != null && nearestProx?.p.skinT != null)
      ? dSample.d.skinT - nearestProx.p.skinT
      : null
    
    merged.push({
      t: dSample.t,
      d: dSample.d,
      p: nearestProx ? nearestProx.p : {},
      dpg
    })
  })
  
  return merged
}

// Parse events CSV
function parseEventsCSV(text, baseDate, dateRange = []) {
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const baseDateObj = baseDate ? parseISO(baseDate) : new Date()
        
        const events = results.data.map((row, idx) => {
          const eventType = (row.event_type || row['Event Type'] || 'unknown').trim()
          let startTime, endTime
          
          // Try to parse start time
          const startStr = row.start_time || row['Start Time']
          const endStr = row.end_time || row['End Time']
          
          if (!startStr || !endStr) {
            return null
          }
          
          // Check if ISO format (contains 'T' or '-')
          if (startStr.includes('T') || startStr.includes('-')) {
            startTime = parseISO(startStr)
            endTime = parseISO(endStr)
          } else {
            // HH:MM:SS format - combine with base date
            startTime = parseTimeValue(startStr, baseDateObj)
            endTime = parseTimeValue(endStr, baseDateObj)
            
            // Handle midnight rollover for events
            if (endTime && startTime && endTime < startTime) {
              endTime = addDays(endTime, 1)
            }
          }
          
          if (!startTime || !endTime) {
            return null
          }
          
          // Determine which date this event is on (for multi-day data)
          const eventDateStr = startTime.toISOString().split('T')[0]
          
          return {
            id: row.event_id || `event_${idx}`,
            type: eventType,
            typeWithDate: dateRange.length > 1 ? `${eventType} (${startTime.toLocaleDateString('en-GB')})` : eventType,
            startTime,
            endTime,
            eventDate: eventDateStr,
            location: row['work location'] || row.location || '',
            source: row.source_text || row.source || '',
            notes: row.Notes || row.notes || ''
          }
        }).filter(e => e !== null)
        
        resolve(events)
      },
      error: (error) => reject(error)
    })
  })
}

// Auto-assign colors to event types
function autoPaletteForTypes(types) {
  const palette = {}
  types.forEach((type, idx) => {
    palette[type] = COLOR_PALETTE.events[idx % COLOR_PALETTE.events.length]
  })
  return palette
}

// Extract date from filename like "ARGDIST-20250010 - 30-06-2025 - 14h52m13s 1.csv"
const extractDateFromFilename = (filename) => {
  if (!filename) return null
  // Match pattern: DD-MM-YYYY
  const match = filename.match(/(\d{2})-(\d{2})-(\d{4})/)
  if (match) {
    const [, day, month, year] = match
    // Convert to YYYY-MM-DD format
    return `${year}-${month}-${day}`
  }
  return null
}

// ===== MAIN APP COMPONENT =====
export default function App() {
  // State
  const [baseDate, setBaseDate] = useState('')
  const [distalText, setDistalText] = useState('')
  const [proximalText, setProximalText] = useState('')
  const [eventsText, setEventsText] = useState('')
  
  const [parsedDistal, setParsedDistal] = useState([])
  const [parsedProximal, setParsedProximal] = useState([])
  const [parsedEvents, setParsedEvents] = useState([])
  const [mergedData, setMergedData] = useState([])
  
  // Manual event entry state (v1.1)
  const [manualEvents, setManualEvents] = useState([])
  const [eventForm, setEventForm] = useState({
    activityType: '',
    date: new Date().toISOString().split('T')[0],
    startTime: '',
    endTime: '',
    notes: ''
  })
  const [editingEventId, setEditingEventId] = useState(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  
  // File analysis state (v1.1.1)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisComplete, setAnalysisComplete] = useState(false)
  const [analysisResults, setAnalysisResults] = useState({
    startDate: null,
    endDate: null,
    startTime: null,
    endTime: null,
    distalRows: 0,
    proximalRows: 0,
    spansDays: false,
    dateRange: []
  })
  const [distalFilename, setDistalFilename] = useState('')
  const [proximalFilename, setProximalFilename] = useState('')
  
  const [errors, setErrors] = useState({ distal: '', proximal: '', events: '' })
  const [activeTab, setActiveTab] = useState('chart')
  
  // Overlay toggles
  const [overlayToggles, setOverlayToggles] = useState({
    skinT: true,
    dpg: true,
    ambT: false,
    accX: false,
    accY: false,
    accZ: false,
    gyroX: false,
    gyroY: false,
    gyroZ: false,
    hf: false
  })
  
  const [eventTypeToggles, setEventTypeToggles] = useState({})
  const [eventPalette, setEventPalette] = useState({})
  const [hoveredEventType, setHoveredEventType] = useState(null)
  
  // Axis domains
  const [xDomain, setXDomain] = useState({ auto: true, min: null, max: null })
  const [yDomain, setYDomain] = useState({ auto: true, min: null, max: null })
  const [yRightDomain, setYRightDomain] = useState({ auto: true, min: null, max: null })
  
  // Zoom and pan state
  const [refAreaLeft, setRefAreaLeft] = useState('')
  const [refAreaRight, setRefAreaRight] = useState('')
  const [zoomHistory, setZoomHistory] = useState([])
  
  // Debounced text for auto-parsing
  const [debouncedDistalText] = useDebounce(distalText, 500)
  const [debouncedProximalText] = useDebounce(proximalText, 500)
  
  // Load sample data on mount
  const loadSampleData = useCallback(async () => {
    try {
      const baseUrl = import.meta.env.BASE_URL || '/'
      const [distal, proximal, events] = await Promise.all([
        fetch(`${baseUrl}assets/sample_distal.csv`).then(r => r.text()),
        fetch(`${baseUrl}assets/sample_proximal.csv`).then(r => r.text()),
        fetch(`${baseUrl}assets/sample_events.csv`).then(r => r.text())
      ])
      setDistalText(distal)
      setProximalText(proximal)
      setEventsText(events)
    } catch (error) {
      console.error('Failed to load sample data:', error)
      // Fallback: show error to user
      setErrors(prev => ({ ...prev, distal: 'Failed to load sample data. Please upload CSV files manually.' }))
    }
  }, [])
  
  // Parse and merge handler
  const handleParseAndMerge = useCallback(async () => {
    setErrors({ distal: '', proximal: '', events: '' })
    
    try {
      // Parse distal
      if (!distalText || !proximalText) {
        setErrors(prev => ({ ...prev, distal: 'Please load or paste CSV data' }))
        return
      }
      
      const distalRaw = await parseCSV(distalText)
      const baseDateObj = new Date(baseDate)
      
      const distalParsed = distalRaw.map(row => {
        const mapped = mapHeaders(row)
        const t = parseTimeValue(mapped.time, baseDateObj)
        return {
          t,
          d: {
            skinT: mapped.skinT,
            ambT: mapped.ambT,
            accX: mapped.accX,
            accY: mapped.accY,
            accZ: mapped.accZ,
            gyroX: mapped.gyroX,
            gyroY: mapped.gyroY,
            gyroZ: mapped.gyroZ,
            hf: mapped.hf,
            hr: mapped.hr,
            spo2: mapped.spo2
          }
        }
      }).filter(s => s.t !== null)
      
      const distalWithRollover = applyMidnightRollover(distalParsed)
      setParsedDistal(distalWithRollover)
      
      // Parse proximal
      const proximalRaw = await parseCSV(proximalText)
      
      const proximalParsed = proximalRaw.map(row => {
        const mapped = mapHeaders(row)
        const t = parseTimeValue(mapped.time, baseDateObj)
        return {
          t,
          p: {
            skinT: mapped.skinT,
            ambT: mapped.ambT,
            accX: mapped.accX,
            accY: mapped.accY,
            accZ: mapped.accZ,
            gyroX: mapped.gyroX,
            gyroY: mapped.gyroY,
            gyroZ: mapped.gyroZ,
            hf: mapped.hf,
            hr: mapped.hr,
            spo2: mapped.spo2
          }
        }
      }).filter(s => s.t !== null)
      
      const proximalWithRollover = applyMidnightRollover(proximalParsed)
      setParsedProximal(proximalWithRollover)
      
      // Merge
      const merged = mergeStreams(distalWithRollover, proximalWithRollover)
      setMergedData(merged)
      
      // Parse events
      if (eventsText) {
        const events = await parseEventsCSV(eventsText, baseDate, analysisResults.dateRange)
        
        // Check event limit
        if (events.length > MAX_EVENTS) {
          setErrors(prev => ({ ...prev, events: `CSV contains ${events.length} events. Maximum ${MAX_EVENTS} events allowed. Please reduce the number of events in your CSV file.` }))
          return
        }
        
        setParsedEvents(events)
        
        // Setup event type toggles - use typeWithDate for multi-day scenarios
        const types = [...new Set(events.map(e => e.typeWithDate || e.type))]
        const toggles = {}
        types.forEach(type => { toggles[type] = true })
        setEventTypeToggles(toggles)
        setEventPalette(autoPaletteForTypes(types))
      }
      
      // Auto-fit domains
      if (merged.length > 0) {
        const times = merged.map(s => s.t.getTime())
        setXDomain({ auto: true, min: new Date(Math.min(...times)), max: new Date(Math.max(...times)) })
      }
      
    } catch (error) {
      setErrors(prev => ({ ...prev, distal: error.message }))
    }
  }, [distalText, proximalText, eventsText, baseDate, analysisResults.dateRange])
  
  // Chart data transformation
  const chartData = useMemo(() => {
    return mergedData.map(sample => ({
      time: sample.t.getTime(),
      timeLabel: sample.t.toLocaleTimeString(),
      // Distal
      dSkinT: overlayToggles.skinT ? sample.d.skinT : null,
      dAmbT: overlayToggles.ambT ? sample.d.ambT : null,
      dAccX: overlayToggles.accX ? sample.d.accX : null,
      dAccY: overlayToggles.accY ? sample.d.accY : null,
      dAccZ: overlayToggles.accZ ? sample.d.accZ : null,
      dGyroX: overlayToggles.gyroX ? sample.d.gyroX : null,
      dGyroY: overlayToggles.gyroY ? sample.d.gyroY : null,
      dGyroZ: overlayToggles.gyroZ ? sample.d.gyroZ : null,
      dHF: overlayToggles.hf ? sample.d.hf : null,
      // Proximal
      pSkinT: overlayToggles.skinT ? sample.p.skinT : null,
      pAmbT: overlayToggles.ambT ? sample.p.ambT : null,
      pAccX: overlayToggles.accX ? sample.p.accX : null,
      pAccY: overlayToggles.accY ? sample.p.accY : null,
      pAccZ: overlayToggles.accZ ? sample.p.accZ : null,
      pGyroX: overlayToggles.gyroX ? sample.p.gyroX : null,
      pGyroY: overlayToggles.gyroY ? sample.p.gyroY : null,
      pGyroZ: overlayToggles.gyroZ ? sample.p.gyroZ : null,
      pHF: overlayToggles.hf ? sample.p.hf : null,
      // DPG
      dpg: overlayToggles.dpg ? sample.dpg : null
    }))
  }, [mergedData, overlayToggles])
  
  // Visible events
  const visibleEvents = useMemo(() => {
    return parsedEvents.filter(event => {
      const toggleKey = event.typeWithDate || event.type
      return eventTypeToggles[toggleKey]
    })
  }, [parsedEvents, eventTypeToggles])
  
  // Not-in-view events
  const notInViewEvents = useMemo(() => {
    if (!xDomain.min || !xDomain.max) return []
    
    return visibleEvents.filter(event => {
      const start = event.startTime.getTime()
      const end = event.endTime.getTime()
      const viewStart = xDomain.min.getTime()
      const viewEnd = xDomain.max.getTime()
      
      return end < viewStart || start > viewEnd
    })
  }, [visibleEvents, xDomain])
  
  // ===== FILE ANALYSIS FUNCTION (v1.1.1) =====
  const analyzeFiles = async () => {
    if (!distalText && !proximalText) {
      setErrors(prev => ({ ...prev, distal: 'Please upload Distal and/or Proximal files first.' }))
      return
    }
    
    setIsAnalyzing(true)
    setErrors({ distal: '', proximal: '', events: '' })
    
    try {
      const baseDateObj = baseDate ? parseISO(baseDate) : new Date()
      let allTimestamps = []
      let distalCount = 0
      let proximalCount = 0
      
      // Analyze Distal
      if (distalText) {
        const distalRaw = await parseCSV(distalText)
        distalCount = distalRaw.length
        
        const distalParsed = distalRaw.map(row => {
          const mapped = mapHeaders(row)
          const t = parseTimeValue(mapped.time, baseDateObj)
          return { t }
        }).filter(s => s.t !== null)
        
        const distalWithRollover = applyMidnightRollover(distalParsed)
        allTimestamps.push(...distalWithRollover.map(s => s.t))
      }
      
      // Analyze Proximal
      if (proximalText) {
        const proximalRaw = await parseCSV(proximalText)
        proximalCount = proximalRaw.length
        
        const proximalParsed = proximalRaw.map(row => {
          const mapped = mapHeaders(row)
          const t = parseTimeValue(mapped.time, baseDateObj)
          return { t }
        }).filter(s => s.t !== null)
        
        const proximalWithRollover = applyMidnightRollover(proximalParsed)
        allTimestamps.push(...proximalWithRollover.map(s => s.t))
      }
      
      if (allTimestamps.length === 0) {
        setErrors(prev => ({ ...prev, distal: 'No valid timestamps found in uploaded files.' }))
        setIsAnalyzing(false)
        return
      }
      
      // Sort timestamps
      allTimestamps.sort((a, b) => a.getTime() - b.getTime())
      
      const startTime = allTimestamps[0]
      const endTime = allTimestamps[allTimestamps.length - 1]
      
      // Extract unique dates
      const uniqueDates = [...new Set(allTimestamps.map(t => t.toISOString().split('T')[0]))]
      const spansDays = uniqueDates.length > 1
      
      // Format times for display
      const formatTime = (date) => {
        return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      }
      
      const formatDate = (date) => {
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
      }
      
      setAnalysisResults({
        startDate: formatDate(startTime),
        endDate: formatDate(endTime),
        startTime: formatTime(startTime),
        endTime: formatTime(endTime),
        distalRows: distalCount,
        proximalRows: proximalCount,
        spansDays,
        dateRange: uniqueDates
      })
      
      setAnalysisComplete(true)
    } catch (error) {
      setErrors(prev => ({ ...prev, distal: `Analysis failed: ${error.message}` }))
    } finally {
      setIsAnalyzing(false)
    }
  }
  
  // Handle file upload
  const handleFileUpload = (type) => (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      if (type === 'distal') {
        setDistalText(text)
        setDistalFilename(file.name)
        // Try to extract date from filename
        const extractedDate = extractDateFromFilename(file.name)
        if (extractedDate) {
          setBaseDate(`${extractedDate}T08:00`)
        }
      } else if (type === 'proximal') {
        setProximalText(text)
        setProximalFilename(file.name)
        // Try to extract date from filename
        const extractedDate = extractDateFromFilename(file.name)
        if (extractedDate) {
          setBaseDate(`${extractedDate}T08:00`)
        }
      } else if (type === 'events') {
        setEventsText(text)
      }
      
      // Reset analysis when new files uploaded
      setAnalysisComplete(false)
    }
    reader.readAsText(file)
  }
  
  // Clear all data
  const handleClear = () => {
    setDistalText('')
    setProximalText('')
    setEventsText('')
    setParsedDistal([])
    setParsedProximal([])
    setParsedEvents([])
    setMergedData([])
    setErrors({ distal: '', proximal: '', events: '' })
    setDistalFilename('')
    setProximalFilename('')
    setAnalysisComplete(false)
    setAnalysisResults({
      startDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
      distalRows: 0,
      proximalRows: 0,
      spansDays: false,
      dateRange: []
    })
  }
  
  // Toggle overlay
  const handleToggleOverlay = (key) => {
    setOverlayToggles(prev => ({ ...prev, [key]: !prev[key] }))
  }
  
  // Toggle event type
  const handleToggleEventType = (type) => {
    setEventTypeToggles(prev => ({ ...prev, [type]: !prev[type] }))
  }
  
  // Zoom handlers
  const handleMouseDown = (e) => {
    if (e && e.activeLabel) {
      setRefAreaLeft(e.activeLabel)
    }
  }
  
  const handleMouseMove = (e) => {
    if (refAreaLeft && e && e.activeLabel) {
      setRefAreaRight(e.activeLabel)
    }
  }
  
  const handleMouseUp = () => {
    if (refAreaLeft && refAreaRight && refAreaLeft !== refAreaRight) {
      // Save current state to history
      setZoomHistory(prev => [...prev, { 
        min: xDomain.min, 
        max: xDomain.max 
      }])
      
      // Zoom in
      const left = Math.min(refAreaLeft, refAreaRight)
      const right = Math.max(refAreaLeft, refAreaRight)
      
      setXDomain({
        auto: false,
        min: new Date(left),
        max: new Date(right)
      })
    }
    
    setRefAreaLeft('')
    setRefAreaRight('')
  }
  
  const handleZoomOut = () => {
    if (zoomHistory.length > 0) {
      const previousState = zoomHistory[zoomHistory.length - 1]
      setXDomain({
        auto: previousState.min === null,
        min: previousState.min,
        max: previousState.max
      })
      setZoomHistory(prev => prev.slice(0, -1))
    } else {
      // Reset to auto-fit
      if (mergedData.length > 0) {
        const times = mergedData.map(s => s.t.getTime())
        setXDomain({ 
          auto: true, 
          min: new Date(Math.min(...times)), 
          max: new Date(Math.max(...times)) 
        })
      }
    }
  }
  
  const handleResetZoom = () => {
    if (mergedData.length > 0) {
      const times = mergedData.map(s => s.t.getTime())
      setXDomain({ 
        auto: true, 
        min: new Date(Math.min(...times)), 
        max: new Date(Math.max(...times)) 
      })
      setZoomHistory([])
    }
  }
  
  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null
    
    return (
      <div className="bg-white border border-gray-300 p-3 rounded shadow-lg">
        <p className="font-semibold text-sm mb-2">{payload[0]?.payload?.timeLabel}</p>
        {payload.map((entry, idx) => (
          <p key={idx} className="text-xs" style={{ color: entry.color }}>
            {entry.name}: {entry.value?.toFixed(2) ?? 'N/A'}
          </p>
        ))}
      </div>
    )
  }
  
  // ===== MANUAL EVENT HANDLERS (v1.1) =====
  
  // Generate UUID for events
  const generateId = () => `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  
  // Convert manual events to CSV format
  const manualEventsToCSV = (events) => {
    if (events.length === 0) return ''
    
    const headers = 'Start Time,End Time,Event Type,Notes'
    const rows = events.map(event => {
      const startISO = `${event.date}T${event.startTime}:00`
      const endISO = `${event.date}T${event.endTime}:00`
      return `${startISO},${endISO},${event.activityType},${event.notes || ''}`
    })
    
    return [headers, ...rows].join('\n')
  }
  
  // Handle form input changes
  const handleEventFormChange = (field, value) => {
    setEventForm(prev => ({ ...prev, [field]: value }))
  }
  
  // Validate event form
  const validateEventForm = () => {
    if (!eventForm.activityType) {
      setErrors(prev => ({ ...prev, events: 'Activity type is required' }))
      return false
    }
    if (!eventForm.date || !eventForm.startTime || !eventForm.endTime) {
      setErrors(prev => ({ ...prev, events: 'Date, start time, and end time are required' }))
      return false
    }
    
    // Validate date against analyzed date range (if analysis complete)
    if (analysisComplete && analysisResults.dateRange.length > 0) {
      const selectedDate = eventForm.date
      if (!analysisResults.dateRange.includes(selectedDate)) {
        const dateRangeStr = analysisResults.dateRange.map(d => new Date(d).toLocaleDateString('en-GB')).join(', ')
        setErrors(prev => ({ ...prev, events: `Event date must be within the data range: ${dateRangeStr}` }))
        return false
      }
    }
    
    if (eventForm.startTime >= eventForm.endTime) {
      setErrors(prev => ({ ...prev, events: 'End time must be after start time' }))
      return false
    }
    // Notes are mandatory only for 'Other' activity type
    if (eventForm.activityType === 'Other' && (!eventForm.notes || eventForm.notes.trim().length === 0)) {
      setErrors(prev => ({ ...prev, events: 'Notes are required for "Other" activity type' }))
      return false
    }
    if (eventForm.notes && eventForm.notes.length > 30) {
      setErrors(prev => ({ ...prev, events: 'Notes must be 30 characters or less' }))
      return false
    }
    setErrors(prev => ({ ...prev, events: '' }))
    return true
  }
  
  // Add or update manual event
  const handleAddEvent = () => {
    if (!validateEventForm()) return
    
    // Check 10 event limit for new events
    if (!editingEventId && manualEvents.length >= MAX_EVENTS) {
      setErrors(prev => ({ ...prev, events: `Maximum ${MAX_EVENTS} events allowed. Please delete an event before adding more.` }))
      return
    }
    
    // Only show confirmation dialog when switching from CSV to manual
    // Don't show when adding multiple manual events
    if (!editingEventId && eventsText && manualEvents.length === 0) {
      // User has CSV data but no manual events yet - switching modes
      setPendingAction(() => addEventAction)
      setShowConfirmDialog(true)
      return
    }
    
    addEventAction()
  }
  
  const addEventAction = () => {
    let updatedManualEvents
    
    if (editingEventId) {
      // Update existing event
      updatedManualEvents = manualEvents.map(event =>
        event.id === editingEventId
          ? { ...eventForm, id: editingEventId, source: 'manual' }
          : event
      )
      setManualEvents(updatedManualEvents)
      setEditingEventId(null)
    } else {
      // Add new event
      const newEvent = {
        ...eventForm,
        id: generateId(),
        source: 'manual'
      }
      updatedManualEvents = [...manualEvents, newEvent]
      setManualEvents(updatedManualEvents)
    }
    
    // Update CSV textarea
    setEventsText(manualEventsToCSV(updatedManualEvents))
    
    // Convert manual events to parsed format and update parsedEvents
    const parsedManualEvents = updatedManualEvents.map(event => {
      const startTime = parseISO(`${event.date}T${event.startTime}:00`)
      const endTime = parseISO(`${event.date}T${event.endTime}:00`)
      const eventDateStr = event.date
      
      return {
        id: event.id,
        type: event.activityType,
        typeWithDate: analysisResults.spansDays 
          ? `${event.activityType} (${new Date(event.date).toLocaleDateString('en-GB')})` 
          : event.activityType,
        startTime,
        endTime,
        eventDate: eventDateStr,
        notes: event.notes || '',
        source: 'manual'
      }
    })
    
    // Update parsed events and toggles
    setParsedEvents(parsedManualEvents)
    
    // Update event type toggles
    const types = [...new Set(parsedManualEvents.map(e => e.typeWithDate || e.type))]
    const toggles = {}
    types.forEach(type => { toggles[type] = true })
    setEventTypeToggles(toggles)
    setEventPalette(autoPaletteForTypes(types))
    
    // Clear form
    setEventForm({
      activityType: '',
      date: new Date().toISOString().split('T')[0],
      startTime: '',
      endTime: '',
      notes: ''
    })
    setShowConfirmDialog(false)
  }
  
  // Edit event
  const handleEditEvent = (event) => {
    setEventForm({
      activityType: event.activityType,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      notes: event.notes || ''
    })
    setEditingEventId(event.id)
  }
  
  // Delete event
  const handleDeleteEvent = (eventId) => {
    if (window.confirm('Are you sure you want to delete this event?')) {
      const updatedManualEvents = manualEvents.filter(e => e.id !== eventId)
      setManualEvents(updatedManualEvents)
      setEventsText(manualEventsToCSV(updatedManualEvents))
      
      // Convert remaining manual events to parsed format
      const parsedManualEvents = updatedManualEvents.map(event => {
        const startTime = parseISO(`${event.date}T${event.startTime}:00`)
        const endTime = parseISO(`${event.date}T${event.endTime}:00`)
        const eventDateStr = event.date
        
        return {
          id: event.id,
          type: event.activityType,
          typeWithDate: analysisResults.spansDays 
            ? `${event.activityType} (${new Date(event.date).toLocaleDateString('en-GB')})` 
            : event.activityType,
          startTime,
          endTime,
          eventDate: eventDateStr,
          notes: event.notes || '',
          source: 'manual'
        }
      })
      
      // Update parsed events and toggles
      setParsedEvents(parsedManualEvents)
      
      // Update event type toggles
      if (parsedManualEvents.length > 0) {
        const types = [...new Set(parsedManualEvents.map(e => e.typeWithDate || e.type))]
        const toggles = {}
        types.forEach(type => { toggles[type] = true })
        setEventTypeToggles(toggles)
        setEventPalette(autoPaletteForTypes(types))
      } else {
        setEventTypeToggles({})
        setEventPalette({})
      }
    }
  }
  
  // Clear form
  const handleClearForm = () => {
    setEventForm({
      activityType: '',
      date: new Date().toISOString().split('T')[0],
      startTime: '',
      endTime: '',
      notes: ''
    })
    setEditingEventId(null)
    setErrors(prev => ({ ...prev, events: '' }))
  }
  
  // Handle CSV upload with confirmation
  const handleEventsFileUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      
      // Check if there are existing manual events
      if (manualEvents.length > 0 || eventsText) {
        setPendingAction(() => () => {
          setEventsText(text)
          setManualEvents([])
          setShowConfirmDialog(false)
        })
        setShowConfirmDialog(true)
      } else {
        setEventsText(text)
      }
    }
    reader.readAsText(file)
  }
  
  // Confirmation dialog actions
  const handleConfirmReplace = () => {
    if (pendingAction) {
      pendingAction()
      setPendingAction(null)
    }
    setShowConfirmDialog(false)
  }
  
  const handleCancelReplace = () => {
    setShowConfirmDialog(false)
    setPendingAction(null)
  }
  
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-[1800px] mx-auto">
        {/* Header */}
        <header className="mb-8 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 rounded-2xl shadow-2xl p-8 text-white">
          <div className="flex items-center gap-4 mb-3">
            <div className="bg-white/20 backdrop-blur-sm p-3 rounded-xl">
              <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3v18h18"/>
                <path d="M7 16l4-8 4 8 3-12"/>
                <circle cx="7" cy="16" r="1" fill="currentColor"/>
                <circle cx="11" cy="8" r="1" fill="currentColor"/>
                <circle cx="15" cy="16" r="1" fill="currentColor"/>
              </svg>
            </div>
            <div>
              <h1 className="text-4xl font-bold tracking-tight">
                Wearable Overlay Timeline <span className="text-2xl font-normal opacity-90">{VERSION}</span>
              </h1>
              <p className="text-indigo-100 text-lg mt-1">Visualize and analyze physiological sensor data streams</p>
            </div>
          </div>
        </header>
        
        {/* Top Controls */}
        <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-xl border border-gray-200/50 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Base Date */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                <Calendar className="inline w-4 h-4 mr-1 text-indigo-600" />
                Base Date
              </label>
              <input
                type="datetime-local"
                value={baseDate}
                onChange={(e) => setBaseDate(e.target.value)}
                placeholder="Auto-detected or enter manually"
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
              />
              {(distalFilename || proximalFilename) && baseDate && (
                <p className="text-xs text-green-600 mt-1.5 font-medium">
                  ✓ Auto-detected from filename
                </p>
              )}
            </div>
            
            {/* Actions */}
            <div className="flex items-end gap-2 md:col-span-2">
              <button
                onClick={analyzeFiles}
                disabled={isAnalyzing || (!distalText && !proximalText)}
                className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white px-5 py-2.5 rounded-xl font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                {isAnalyzing ? '⏳ Analyzing...' : '🔍 Analyze Files'}
              </button>
              <button
                onClick={handleParseAndMerge}
                disabled={!analysisComplete || isAnalyzing}
                className="flex-1 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white px-5 py-2.5 rounded-xl font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                📊 Parse & Merge
              </button>
              <button
                onClick={loadSampleData}
                className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-5 py-2.5 rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                🎯 Load Samples
              </button>
              <button
                onClick={handleClear}
                className="bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white p-2.5 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                title="Clear All"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          {/* Analysis Status/Results */}
          {isAnalyzing && (
            <div className="mt-4 p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl flex items-center gap-4 shadow-lg animate-pulse">
              <div className="relative">
                <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-200 border-t-blue-600"></div>
                <div className="absolute inset-0 rounded-full bg-blue-400/20 animate-ping"></div>
              </div>
              <div>
                <p className="font-bold text-blue-900 text-lg">Analyzing uploaded files...</p>
                <p className="text-sm text-blue-700 mt-1">
                  Base date is set as <strong className="font-semibold">{baseDate ? new Date(baseDate).toLocaleDateString('en-GB') : 'Not set'}</strong>, 
                  parsing and analyzing the uploaded CSV files.
                </p>
              </div>
            </div>
          )}
          
          {analysisComplete && !isAnalyzing && (
            <div className="mt-4 p-5 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl shadow-lg">
              <h3 className="font-bold text-green-900 mb-3 text-lg flex items-center gap-2">
                <span className="text-2xl">✅</span> CSV Files Analysis Summary
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <p className="text-gray-800"><strong className="text-green-900">Base Date Entered:</strong> {baseDate ? new Date(baseDate).toLocaleDateString('en-GB') : 'Not set'}</p>
                  <p className="text-gray-800"><strong className="text-green-900">Data Start:</strong> {analysisResults.startDate} at {analysisResults.startTime}</p>
                  <p className="text-gray-800"><strong className="text-green-900">Data End:</strong> {analysisResults.endDate} at {analysisResults.endTime}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-gray-800"><strong className="text-green-900">Distal Rows:</strong> {analysisResults.distalRows}</p>
                  <p className="text-gray-800"><strong className="text-green-900">Proximal Rows:</strong> {analysisResults.proximalRows}</p>
                  {analysisResults.spansDays && (
                    <p className="text-amber-800 font-semibold mt-2 bg-amber-100 px-3 py-2 rounded-lg border border-amber-300">
                      ⚠️ Data spans multiple days ({analysisResults.dateRange.length} days total)
                    </p>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-600 mt-3 bg-white/50 px-3 py-2 rounded-lg">
                💡 You can now click <strong className="text-indigo-700">"Parse & Merge"</strong> to visualize the data on the chart.
              </p>
            </div>
          )}
          
          {/* Data Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            {/* Distal */}
            <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl p-5 border-2 border-red-200 shadow-md">
              <label className="block text-base font-bold text-red-900 mb-3 flex items-center gap-2">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                Distal Sensor CSV
              </label>
              <div className="mb-3">
                <label className="inline-flex items-center px-5 py-2.5 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white rounded-xl cursor-pointer transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 font-semibold">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload File
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload('distal')}
                    className="hidden"
                  />
                </label>
              </div>
              <textarea
                value={distalText}
                onChange={(e) => setDistalText(e.target.value)}
                placeholder="Paste Distal CSV here or upload a file..."
                className="w-full h-32 px-4 py-3 border-2 border-red-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white/80 backdrop-blur-sm transition-all duration-200"
              />
              {errors.distal && (
                <p className="text-red-700 text-sm mt-2 font-medium bg-red-100 px-3 py-2 rounded-lg">{errors.distal}</p>
              )}
            </div>
            
            {/* Proximal */}
            <div className="bg-gradient-to-br from-cyan-50 to-blue-50 rounded-xl p-5 border-2 border-cyan-200 shadow-md">
              <label className="block text-base font-bold text-cyan-900 mb-3 flex items-center gap-2">
                <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse"></div>
                Proximal Sensor CSV
              </label>
              <div className="mb-3">
                <label className="inline-flex items-center px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white rounded-xl cursor-pointer transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 font-semibold">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload File
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload('proximal')}
                    className="hidden"
                  />
                </label>
              </div>
              <textarea
                value={proximalText}
                onChange={(e) => setProximalText(e.target.value)}
                placeholder="Paste Proximal CSV here or upload a file..."
                className="w-full h-32 px-4 py-3 border-2 border-cyan-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 bg-white/80 backdrop-blur-sm transition-all duration-200"
              />
              {errors.proximal && (
                <p className="text-cyan-700 text-sm mt-2 font-medium bg-cyan-100 px-3 py-2 rounded-lg">{errors.proximal}</p>
              )}
            </div>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-xl border border-gray-200/50 overflow-hidden">
          <div className="border-b border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('chart')}
                className={`px-8 py-4 text-sm font-bold border-b-4 transition-all duration-200 relative ${
                  activeTab === 'chart'
                    ? 'border-indigo-600 text-indigo-700 bg-white shadow-lg'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {activeTab === 'chart' && <div className="absolute inset-0 bg-gradient-to-b from-indigo-50 to-transparent opacity-50"></div>}
                <span className="relative">📊 Main Chart</span>
              </button>
              <button
                onClick={() => setActiveTab('events')}
                className={`px-8 py-4 text-sm font-bold border-b-4 transition-all duration-200 relative ${
                  activeTab === 'events'
                    ? 'border-indigo-600 text-indigo-700 bg-white shadow-lg'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {activeTab === 'events' && <div className="absolute inset-0 bg-gradient-to-b from-indigo-50 to-transparent opacity-50"></div>}
                <span className="relative">📍 Events</span>
              </button>
              <button
                onClick={() => setActiveTab('help')}
                className={`px-8 py-4 text-sm font-bold border-b-4 transition-all duration-200 relative ${
                  activeTab === 'help'
                    ? 'border-indigo-600 text-indigo-700 bg-white shadow-lg'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {activeTab === 'help' && <div className="absolute inset-0 bg-gradient-to-b from-indigo-50 to-transparent opacity-50"></div>}
                <span className="relative flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  Help
                </span>
              </button>
            </nav>
          </div>
          
          <div className="p-8">
            {/* Chart Tab */}
            {activeTab === 'chart' && (
              <div>
                {/* Not-in-view banner */}
                {notInViewEvents.length > 0 && (
                  <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-300 rounded-xl p-4 mb-6 shadow-md">
                    <p className="text-sm text-amber-900 font-medium">
                      <strong className="text-amber-800">⚠️ Not shown:</strong>{' '}
                      {Object.entries(
                        notInViewEvents.reduce((acc, e) => {
                          acc[e.type] = (acc[e.type] || 0) + 1
                          return acc
                        }, {})
                      ).map(([type, count]) => `${type} (${count})`).join(', ')}
                    </p>
                  </div>
                )}
                
                {/* Overlay Toggles */}
                <div className="mb-6 p-6 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl border-2 border-purple-200 shadow-lg">
                  <h3 className="text-base font-bold text-purple-900 mb-4 flex items-center gap-2">
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                    Overlay Toggles
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {Object.keys(overlayToggles).map(key => (
                      <label key={key} className="flex items-center space-x-3 cursor-pointer px-3 py-2 bg-white/60 hover:bg-white rounded-lg transition-all duration-200 hover:shadow-md">
                        <input
                          type="checkbox"
                          checked={overlayToggles[key]}
                          onChange={() => handleToggleOverlay(key)}
                          className="w-5 h-5 text-indigo-600 rounded-md focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                        />
                        <span className="text-sm text-gray-800 font-medium capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                      </label>
                    ))}
                  </div>
                  
                  {Object.keys(eventTypeToggles).length > 0 && (
                    <>
                      <h3 className="text-base font-bold text-purple-900 mt-6 mb-4 flex items-center gap-2">
                        <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                        Event Types
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        {Object.keys(eventTypeToggles).map(type => (
                          <label 
                            key={type} 
                            className="flex items-center space-x-3 cursor-pointer px-3 py-2 bg-white/60 hover:bg-white rounded-lg transition-all duration-200 hover:shadow-md"
                            onMouseEnter={() => setHoveredEventType(type)}
                            onMouseLeave={() => setHoveredEventType(null)}
                          >
                            <input
                              type="checkbox"
                              checked={eventTypeToggles[type]}
                              onChange={() => handleToggleEventType(type)}
                              className="w-5 h-5 text-indigo-600 rounded-md focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                            />
                            <span className="text-sm text-gray-800 font-medium">{type}</span>
                            <div
                              className="w-5 h-5 rounded-md shadow-sm border-2 border-white"
                              style={{ backgroundColor: eventPalette[type] }}
                            />
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                
                {/* Zoom Controls */}
                {chartData.length > 0 && (
                  <div className="mb-6 flex gap-3">
                    <button
                      onClick={handleZoomOut}
                      disabled={zoomHistory.length === 0 && xDomain.auto}
                      className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:transform-none"
                      title="Zoom Out (Undo last zoom)"
                    >
                      <ZoomOut className="w-5 h-5" />
                      Zoom Out
                    </button>
                    <button
                      onClick={handleResetZoom}
                      disabled={xDomain.auto && zoomHistory.length === 0}
                      className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:transform-none"
                      title="Reset to full view"
                    >
                      <Maximize2 className="w-5 h-5" />
                      Reset Zoom
                    </button>
                    <div className="flex items-center text-sm text-gray-700 ml-4 bg-blue-50 px-4 py-2 rounded-xl border border-blue-200">
                      <ZoomIn className="w-5 h-5 mr-2 text-blue-600" />
                      <span className="font-medium">Click and drag on the chart to zoom in to a specific region</span>
                    </div>
                  </div>
                )}
                
                {/* Chart */}
                {chartData.length > 0 ? (
                  <div className="relative">
                    <ResponsiveContainer width="100%" height={600}>
                      <ComposedChart 
                        data={chartData}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="time"
                          type="number"
                          domain={xDomain.auto ? ['dataMin', 'dataMax'] : [xDomain.min?.getTime(), xDomain.max?.getTime()]}
                          tickFormatter={(time) => new Date(time).toLocaleTimeString()}
                          scale="time"
                        />
                        <YAxis yAxisId="left" />
                        <YAxis yAxisId="right" orientation="right" />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend />
                        
                        {/* Zoom selection area */}
                        {refAreaLeft && refAreaRight && (
                          <ReferenceArea
                            yAxisId="left"
                            x1={refAreaLeft}
                            x2={refAreaRight}
                            strokeOpacity={0.3}
                            fill="#8884d8"
                            fillOpacity={0.3}
                          />
                        )}
                        
                        {/* Event bands */}
                        {visibleEvents.map((event, index) => {
                          const start = event.startTime.getTime()
                          const end = event.endTime.getTime()
                          const displayType = event.typeWithDate || event.type
                          
                          // Only show label when this event type is hovered in the toggles
                          const showLabel = hoveredEventType === displayType
                          
                          // Smart label positioning - calculate vertical offset to avoid overlap
                          let labelPosition = 'center'
                          let yOffset = 0
                          
                          if (showLabel) {
                            // Check if this event overlaps with previous events
                            for (let i = 0; i < index; i++) {
                              const prevEvent = visibleEvents[i]
                              const prevStart = prevEvent.startTime.getTime()
                              const prevEnd = prevEvent.endTime.getTime()
                              
                              // Check for temporal overlap or proximity (within 10% of view)
                              const viewRange = (xDomain.max?.getTime() || end) - (xDomain.min?.getTime() || start)
                              const proximityThreshold = viewRange * 0.1
                              
                              const isOverlapping = !(end < prevStart || start > prevEnd)
                              const isNearby = Math.abs(start - prevEnd) < proximityThreshold || Math.abs(prevStart - end) < proximityThreshold
                              
                              if (isOverlapping || isNearby) {
                                // Alternate label positions: top, center, bottom, insideTop, insideBottom
                                const positions = ['top', 'insideTop', 'center', 'insideBottom', 'bottom']
                                yOffset = (yOffset + 1) % positions.length
                                labelPosition = positions[yOffset]
                              }
                            }
                          }
                          
                          return (
                            <ReferenceArea
                              key={event.id}
                              x1={start}
                              x2={end}
                              yAxisId="left"
                              fill={eventPalette[displayType]}
                              fillOpacity={0.3}
                              label={showLabel ? {
                                value: displayType,
                                position: labelPosition,
                                fill: '#374151',
                                fontSize: 12,
                                fontWeight: 600
                              } : undefined}
                            />
                          )
                        })}
                        
                        {/* Lines */}
                        {overlayToggles.skinT && (
                          <>
                            <Line yAxisId="left" type="monotone" dataKey="dSkinT" stroke={COLOR_PALETTE.distal.skinT} name="Distal SkinT" dot={false} strokeWidth={2} />
                            <Line yAxisId="left" type="monotone" dataKey="pSkinT" stroke={COLOR_PALETTE.proximal.skinT} name="Proximal SkinT" dot={false} strokeWidth={2} strokeDasharray="5 5" />
                          </>
                        )}
                        {overlayToggles.dpg && (
                          <Line yAxisId="left" type="monotone" dataKey="dpg" stroke={COLOR_PALETTE.dpg} name="DPG" dot={false} strokeWidth={2} />
                        )}
                        {overlayToggles.ambT && (
                          <>
                            <Line yAxisId="left" type="monotone" dataKey="dAmbT" stroke={COLOR_PALETTE.distal.ambT} name="Distal AmbT" dot={false} />
                            <Line yAxisId="left" type="monotone" dataKey="pAmbT" stroke={COLOR_PALETTE.proximal.ambT} name="Proximal AmbT" dot={false} strokeDasharray="5 5" />
                          </>
                        )}
                        {overlayToggles.accX && (
                          <>
                            <Line yAxisId="left" type="monotone" dataKey="dAccX" stroke={COLOR_PALETTE.distal.accX} name="Distal AccX" dot={false} />
                            <Line yAxisId="left" type="monotone" dataKey="pAccX" stroke={COLOR_PALETTE.proximal.accX} name="Proximal AccX" dot={false} strokeDasharray="5 5" />
                          </>
                        )}
                        {overlayToggles.accY && (
                          <>
                            <Line yAxisId="left" type="monotone" dataKey="dAccY" stroke={COLOR_PALETTE.distal.accY} name="Distal AccY" dot={false} />
                            <Line yAxisId="left" type="monotone" dataKey="pAccY" stroke={COLOR_PALETTE.proximal.accY} name="Proximal AccY" dot={false} strokeDasharray="5 5" />
                          </>
                        )}
                        {overlayToggles.accZ && (
                          <>
                            <Line yAxisId="left" type="monotone" dataKey="dAccZ" stroke={COLOR_PALETTE.distal.accZ} name="Distal AccZ" dot={false} />
                            <Line yAxisId="left" type="monotone" dataKey="pAccZ" stroke={COLOR_PALETTE.proximal.accZ} name="Proximal AccZ" dot={false} strokeDasharray="5 5" />
                          </>
                        )}
                        {overlayToggles.gyroX && (
                          <>
                            <Line yAxisId="left" type="monotone" dataKey="dGyroX" stroke={COLOR_PALETTE.distal.gyroX} name="Distal GyroX" dot={false} />
                            <Line yAxisId="left" type="monotone" dataKey="pGyroX" stroke={COLOR_PALETTE.proximal.gyroX} name="Proximal GyroX" dot={false} strokeDasharray="5 5" />
                          </>
                        )}
                        {overlayToggles.gyroY && (
                          <>
                            <Line yAxisId="left" type="monotone" dataKey="dGyroY" stroke={COLOR_PALETTE.distal.gyroY} name="Distal GyroY" dot={false} />
                            <Line yAxisId="left" type="monotone" dataKey="pGyroY" stroke={COLOR_PALETTE.proximal.gyroY} name="Proximal GyroY" dot={false} strokeDasharray="5 5" />
                          </>
                        )}
                        {overlayToggles.gyroZ && (
                          <>
                            <Line yAxisId="left" type="monotone" dataKey="dGyroZ" stroke={COLOR_PALETTE.distal.gyroZ} name="Distal GyroZ" dot={false} />
                            <Line yAxisId="left" type="monotone" dataKey="pGyroZ" stroke={COLOR_PALETTE.proximal.gyroZ} name="Proximal GyroZ" dot={false} strokeDasharray="5 5" />
                          </>
                        )}
                        {overlayToggles.hf && (
                          <>
                            <Line yAxisId="right" type="monotone" dataKey="dHF" stroke={COLOR_PALETTE.distal.hf} name="Distal HF" dot={false} />
                            <Line yAxisId="right" type="monotone" dataKey="pHF" stroke={COLOR_PALETTE.proximal.hf} name="Proximal HF" dot={false} strokeDasharray="5 5" />
                          </>
                        )}
                        
                        {/* Brush for pan and zoom */}
                        <Brush 
                          dataKey="timeLabel" 
                          height={30} 
                          stroke="#8884d8"
                          onChange={(brushArea) => {
                            if (brushArea && brushArea.startIndex !== undefined && brushArea.endIndex !== undefined) {
                              const startTime = chartData[brushArea.startIndex]?.time
                              const endTime = chartData[brushArea.endIndex]?.time
                              if (startTime && endTime) {
                                setXDomain({
                                  auto: false,
                                  min: new Date(startTime),
                                  max: new Date(endTime)
                                })
                              }
                            }
                          }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <p>No data loaded. Upload or paste CSV data and click "Parse & Merge".</p>
                  </div>
                )}
              </div>
            )}
            
            {/* Events Tab */}
            {activeTab === 'events' && (
              <div>
                {/* Confirmation Dialog */}
                {showConfirmDialog && (
                  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
                      <div className="flex items-start gap-3 mb-4">
                        <AlertTriangle className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-1" />
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            Replace Existing Events?
                          </h3>
                          <p className="text-sm text-gray-600 mb-2">
                            You currently have {manualEvents.length + parsedEvents.length} event(s) loaded.
                          </p>
                          <p className="text-sm text-gray-600">
                            Adding new events will replace all existing event data. Current events will be lost. Do you want to continue?
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3 justify-end">
                        <button
                          onClick={handleCancelReplace}
                          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleConfirmReplace}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition"
                        >
                          Replace and Continue
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Date Range Info (if multi-day data) */}
                {analysisComplete && analysisResults.spansDays && (
                  <div className="mb-6 p-4 bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-300 rounded-xl shadow-md">
                    <p className="text-sm text-amber-900 font-medium">
                      <strong className="text-amber-800">📅 Multi-day data detected:</strong> Your uploaded files span {analysisResults.dateRange.length} days 
                      ({analysisResults.dateRange.map(d => new Date(d).toLocaleDateString('en-GB')).join(', ')}). 
                      Please select the correct date for your event entry.
                    </p>
                  </div>
                )}
                
                {/* Manual Event Entry Form */}
                <div className="mb-6 p-6 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 rounded-xl border-2 border-blue-300 shadow-lg">
                  <h3 className="text-xl font-bold text-blue-900 mb-5 flex items-center gap-2">
                    <Plus className="w-6 h-6" />
                    Add Event Manually
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                    <div>
                      <label className="block text-sm font-bold text-gray-800 mb-2">
                        Activity Type *
                      </label>
                      <select
                        value={eventForm.activityType}
                        onChange={(e) => handleEventFormChange('activityType', e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white font-medium"
                      >
                        <option value="">Select activity...</option>
                        {ACTIVITY_TYPES.map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-bold text-gray-800 mb-2">
                        Date *
                      </label>
                      <input
                        type="date"
                        value={eventForm.date}
                        onChange={(e) => handleEventFormChange('date', e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white font-medium"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-bold text-gray-800 mb-2">
                        Start Time *
                      </label>
                      <input
                        type="time"
                        value={eventForm.startTime}
                        onChange={(e) => handleEventFormChange('startTime', e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white font-medium"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-bold text-gray-800 mb-2">
                        End Time *
                      </label>
                      <input
                        type="time"
                        value={eventForm.endTime}
                        onChange={(e) => handleEventFormChange('endTime', e.target.value)}
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white font-medium"
                      />
                    </div>
                    
                    {/* Notes field - always visible, mandatory only for 'Other' */}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-bold text-gray-800 mb-2">
                        Notes {eventForm.activityType === 'Other' ? '* (required, ' : '(optional, '}max 30 characters)
                      </label>
                      <input
                        type="text"
                        value={eventForm.notes}
                        onChange={(e) => handleEventFormChange('notes', e.target.value)}
                        maxLength={30}
                        placeholder={eventForm.activityType === 'Other' ? "Brief description..." : "Optional notes..."}
                        className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 bg-white font-medium"
                      />
                      <p className="text-xs text-gray-600 mt-2 font-medium">{eventForm.notes.length}/30 characters</p>
                    </div>
                  </div>
                  
                  <div className="flex gap-3">
                    <button
                      onClick={handleAddEvent}
                      className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-bold transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                    >
                      <Plus className="w-5 h-5" />
                      {editingEventId ? 'Update Event' : 'Add Event'}
                    </button>
                    <button
                      onClick={handleClearForm}
                      className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-100 transition-all duration-200 font-bold"
                    >
                      Clear Form
                    </button>
                  </div>
                  
                  {errors.events && (
                    <p className="text-red-600 text-sm mt-2">{errors.events}</p>
                  )}
                </div>
                
                {/* Current Events Table */}
                {manualEvents.length > 0 && (
                  <div className="mb-6 p-6 bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl border-2 border-gray-200 shadow-lg">
                    <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      Current Events ({manualEvents.length})
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gradient-to-r from-gray-100 to-gray-200 border-b-2 border-gray-300">
                          <tr>
                            <th className="px-4 py-3 text-left font-bold text-gray-700 uppercase tracking-wider text-xs">Activity</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-700 uppercase tracking-wider text-xs">Date</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-700 uppercase tracking-wider text-xs">Start</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-700 uppercase tracking-wider text-xs">End</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-700 uppercase tracking-wider text-xs">Notes</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-700 uppercase tracking-wider text-xs">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {manualEvents.map(event => (
                            <tr key={event.id} className="hover:bg-blue-50 transition-colors duration-150">
                              <td className="px-4 py-3 font-semibold text-gray-900">{event.activityType}</td>
                              <td className="px-4 py-3 text-gray-800 font-medium">{event.date}</td>
                              <td className="px-4 py-3 text-gray-800 font-medium">{event.startTime}</td>
                              <td className="px-4 py-3 text-gray-800 font-medium">{event.endTime}</td>
                              <td className="px-4 py-3 text-gray-600 italic">{event.notes || '—'}</td>
                              <td className="px-4 py-3">
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleEditEvent(event)}
                                    className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition-all duration-200"
                                    title="Edit"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteEvent(event.id)}
                                    className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg transition-all duration-200"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                
                {/* Divider */}
                <div className="flex items-center gap-4 my-8">
                  <div className="flex-1 border-t-2 border-gradient-to-r from-transparent via-gray-300 to-transparent"></div>
                  <span className="text-gray-600 font-bold text-lg px-4 py-2 bg-gray-100 rounded-xl shadow-sm">OR</span>
                  <div className="flex-1 border-t-2 border-gradient-to-r from-transparent via-gray-300 to-transparent"></div>
                </div>
                
                {/* CSV Import Section */}
                <div className="p-6 bg-gradient-to-br from-green-50 to-teal-50 rounded-xl border-2 border-green-200 shadow-lg">
                  <h3 className="text-xl font-bold text-green-900 mb-4 flex items-center gap-2">
                    <Upload className="w-6 h-6" />
                    Import from CSV
                  </h3>
                  <div className="mb-5">
                    <label className="block text-sm font-bold text-gray-800 mb-3">
                      Events CSV File
                    </label>
                    <div className="mb-3 flex gap-3">
                      <label className="inline-flex items-center px-5 py-2.5 bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white rounded-xl cursor-pointer transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 font-semibold">
                        <Upload className="w-5 h-5 mr-2" />
                        Upload Events File
                        <input
                          type="file"
                          accept=".csv"
                          onChange={handleEventsFileUpload}
                          className="hidden"
                        />
                      </label>
                      <button
                        onClick={async () => {
                          try {
                            const baseUrl = import.meta.env.BASE_URL || '/'
                            const events = await fetch(`${baseUrl}assets/sample_events.csv`).then(r => r.text())
                            
                            if (manualEvents.length > 0 || eventsText) {
                              setPendingAction(() => () => {
                                setEventsText(events)
                                setManualEvents([])
                                setShowConfirmDialog(false)
                              })
                              setShowConfirmDialog(true)
                            } else {
                              setEventsText(events)
                            }
                          } catch (error) {
                            console.error('Failed to load sample events:', error)
                            setErrors(prev => ({ ...prev, events: 'Failed to load sample events.' }))
                          }
                        }}className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 font-semibold"
                      >
                        <RefreshCw className="inline w-5 h-5 mr-2" />
                        Reset to Defaults
                      </button>
                    </div>
                    <textarea
                      value={eventsText}
                      onChange={(e) => setEventsText(e.target.value)}
                      placeholder="Paste Events CSV here or upload a file..."
                      className="w-full h-64 px-4 py-3 border-2 border-green-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white/80 backdrop-blur-sm transition-all duration-200"
                    />
                  </div>
                  <button
                    onClick={handleParseAndMerge}
                    className="bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 text-white px-8 py-3 rounded-xl font-bold transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                  >
                    ✅ Apply Events
                  </button>
                </div>
              </div>
            )}
            
            {/* Help Tab */}
            {activeTab === 'help' && (
              <div className="prose prose-sm max-w-none">
                <h2>Quick Start Guide</h2>
                
                <h3>1. Upload Your Data</h3>
                <p>
                  Upload Distal and Proximal sensor CSV files, or try the sample data first. 
                  The app auto-detects date formats (ISO or HH:MM:SS).
                </p>
                
                <h3>2. Required CSV Columns</h3>
                <ul>
                  <li><code>Time</code> - Timestamps (ISO or HH:MM:SS format)</li>
                  <li><code>SkinT [degC]</code>, <code>AmbT [degC]</code> - Temperatures</li>
                  <li><code>Acc X/Y/Z [mg]</code> - Accelerometer data</li>
                  <li><code>Gyro X/Y/Z [mdps]</code> - Gyroscope data</li>
                  <li><code>HF [uV]</code> - Heart flux</li>
                </ul>
                
                <h3>3. Add Events</h3>
                <p><strong>Manual Entry:</strong> Use the form to add activities (exercise, meals, sleep, etc.)</p>
                <p><strong>CSV Import:</strong> Upload events with <code>Start Time</code>, <code>End Time</code>, <code>Event Type</code>, <code>Notes</code></p>
                <p>Events appear as colored bands on the chart. Toggle them on/off as needed.</p>
                
                <h3>4. Navigate the Chart</h3>
                <ul>
                  <li><strong>Zoom In:</strong> Click and drag on the chart to select a region</li>
                  <li><strong>Pan:</strong> Use the timeline brush at the bottom</li>
                  <li><strong>Reset:</strong> Click "Zoom Out" or "Reset Zoom" buttons</li>
                </ul>
                
                <h3>5. Customize View</h3>
                <p>Toggle different sensors: Temperature, DPG (gradient), Accelerometer, Gyroscope, Heart Flux.</p>
                
                <h3>Privacy Note</h3>
                <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
                  ✓ All data processing happens in your browser<br/>
                  ✓ No data is uploaded to any server<br/>
                  ✓ Your files remain completely private
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
