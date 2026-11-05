<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  activities: { type: Array, default: () => [] },
  selectedId: { type: [String, Number], default: null },
  draftLocation: { type: Object, default: null },
  picking: { type: Boolean, default: false },
})

const emit = defineEmits(['activity-selected', 'map-click'])
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const mapElement = ref(null)
const error = ref('')
let map = null
let activityMarkers = []
let draftMarker = null
let clickListener = null
let activityInfoWindow = null
let openActivityId = null
let fittedInitialActivities = false
let mapsPromise

const singapore = { lat: 1.3521, lng: 103.8198 }


function loadMapsApi() {
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve()
  }

  if (mapsPromise) return mapsPromise

  mapsPromise = new Promise((resolve, reject) => {
    const callbackName = '__studentActivityPlannerMapsReady'

    window[callbackName] = () => {
      delete window[callbackName]
      resolve()
    }

    const script = document.createElement('script')

    const params = new URLSearchParams({
      key: API_KEY,
      v: 'weekly',
      loading: 'async',
      callback: callbackName,
    })

    script.src = `https://maps.googleapis.com/maps/api/js?${params}`
    script.async = true
    script.dataset.googleMapsApi = 'true'

    script.onerror = () => {
      delete window[callbackName]
      mapsPromise = null

      reject(
        new Error(
          'Google Maps could not be loaded. Check that the API key is valid and Maps JavaScript API is enabled.'
        )
      )
    }

    document.head.append(script)
  })

  return mapsPromise

}

function markerColor(activity) {
  return activity.outdoor ? '#e5484d' : '#4f5fe8'
}

function activityMarkerIcon(activity, selected) {
  const glyph = activity.outdoor
    ? '<path d="M18 6.5c-5.8.1-9.8 2.7-9.8 6.7 0 2 1.4 3.3 3.4 3.3 3.4 0 5.9-3.8 6.4-10Z"/><path d="M7.5 18c1.7-2.5 4-4.5 7-6" fill="none" stroke="white" stroke-linecap="round" stroke-width="1.4"/>'
    : '<path d="m6.5 11 5.5-4.5 5.5 4.5v6H14v-3.5h-4V17H6.5v-6Z"/><path d="M5.5 10.8 12 5.5l6.5 5.3" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 24 30"><path d="M12 1.5C6.75 1.5 2.5 5.7 2.5 10.9c0 6.1 9.5 17.2 9.5 17.2s9.5-11.1 9.5-17.2C21.5 5.7 17.25 1.5 12 1.5Z" fill="${markerColor(activity)}" stroke="white" stroke-width="${selected ? 2.3 : 1.5}"/><g fill="white">${glyph}</g></svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(selected ? 40 : 34, selected ? 49 : 42),
    anchor: new window.google.maps.Point(selected ? 20 : 17, selected ? 48 : 41),
  }
}

function activityInfoContent(activity) {
  const content = document.createElement('div')
  content.style.cssText = 'max-width:260px;padding:4px 6px 6px;color:#26304b;font:14px/1.45 Arial,sans-serif'

  const type = document.createElement('div')
  type.textContent = activity.outdoor ? 'OUTDOOR ACTIVITY' : 'INDOOR ACTIVITY'
  type.style.cssText = `display:inline-block;margin-bottom:7px;padding:3px 8px;border-radius:999px;background:${markerColor(activity)};color:white;font-size:10px;font-weight:700;letter-spacing:.06em`

  const title = document.createElement('div')
  title.textContent = activity.title || 'Activity'
  title.style.cssText = 'margin-bottom:5px;font-size:15px;font-weight:700;line-height:1.3'

  const when = document.createElement('div')
  const date = new Date(activity.when)
  const end = new Date(activity.end)
  const dateText = date.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })
  const startTime = date.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })
  const endTime = end.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })
  when.textContent = `${dateText} · ${startTime}–${endTime}`
  when.style.cssText = 'color:#59627a'

  content.append(type, title, when)
  if (activity.place) {
    const place = document.createElement('div')
    place.textContent = activity.place
    place.style.cssText = 'margin-top:5px;font-weight:600'
    content.append(place)
  }
  if (activity.notes) {
    const notes = document.createElement('div')
    notes.textContent = activity.notes
    notes.style.cssText = 'margin-top:6px;color:#59627a;white-space:pre-wrap'
    content.append(notes)
  }
  if (activity.done) {
    const done = document.createElement('div')
    done.textContent = 'Completed'
    done.style.cssText = 'margin-top:7px;color:#59627a;font-size:12px;font-weight:700'
    content.append(done)
  }
  return content
}

function clearActivityMarkers() {
  activityMarkers.forEach((marker) => marker.setMap(null))
  activityMarkers = []
}

function updateActivityMarkers() {
  if (!map || !window.google?.maps) return
  if (openActivityId !== null) activityInfoWindow?.close()
  clearActivityMarkers()

  activityMarkers = props.activities
    .filter((activity) => Number.isFinite(activity.lat) && Number.isFinite(activity.lng))
    .map((activity) => {
      const isSelected = activity.id === props.selectedId
      const marker = new window.google.maps.Marker({
        map,
        position: { lat: activity.lat, lng: activity.lng },
        title: `${activity.title}${activity.place ? ` · ${activity.place}` : ''}`,
        icon: activityMarkerIcon(activity, isSelected),
        zIndex: isSelected ? 2 : 1,
      })
      marker.activityId = activity.id
      marker.addListener('click', () => {
        openActivityId = activity.id
        focusLocation(activity.lat, activity.lng, 15)
        activityInfoWindow.setContent(activityInfoContent(activity))
        activityInfoWindow.open({ map, anchor: marker })
        emit('activity-selected', activity)
      })
      return marker
    })

  if (openActivityId !== null) {
    const active = props.activities.find((activity) => activity.id === openActivityId)
    const activeMarker = activityMarkers.find((marker) => marker.activityId === openActivityId)
    if (active && activeMarker) {
      activityInfoWindow.setContent(activityInfoContent(active))
      activityInfoWindow.open({ map, anchor: activeMarker })
    } else {
      openActivityId = null
    }
  }

  if (!fittedInitialActivities && activityMarkers.length) {
    const bounds = new window.google.maps.LatLngBounds()
    activityMarkers.forEach((marker) => bounds.extend(marker.getPosition()))
    if (activityMarkers.length === 1) {
      map.setCenter(bounds.getCenter())
      map.setZoom(14)
    } else {
      map.fitBounds(bounds, 48)
    }
    fittedInitialActivities = true
  }
}

function updateDraftMarker() {
  if (!map || !window.google?.maps) return
  const point = props.picking && props.draftLocation
  if (!point) {
    draftMarker?.setMap(null)
    draftMarker = null
    return
  }
  if (!draftMarker) {
    draftMarker = new window.google.maps.Marker({
      map,
      title: 'New activity location',
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        fillColor: '#5b5bf0',
        fillOpacity: 0.8,
        strokeColor: '#fff',
        strokeWeight: 3,
        scale: 11,
      },
      zIndex: 10,
    })
  }
  draftMarker.setPosition({ lat: point.lat, lng: point.lng })
  draftMarker.setMap(map)
}

function onMapClick(event) {
  if (!props.picking || !event.latLng) return
  emit('map-click', { lat: event.latLng.lat(), lng: event.latLng.lng() })
}

function focusLocation(lat, lng, zoom = 15) {
  if (!map) return
  map.panTo({ lat, lng })
  map.setZoom(Math.max(map.getZoom() || 0, zoom))
}

function focusActivity(activity) {
  if (Number.isFinite(activity?.lat) && Number.isFinite(activity?.lng)) {
    focusLocation(activity.lat, activity.lng)
  }
}

function resetMap() {
  if (!map) return
  const locatedActivities = props.activities.filter((activity) => Number.isFinite(activity.lat) && Number.isFinite(activity.lng))
  if (!locatedActivities.length) {
    map.setCenter(singapore)
    map.setZoom(11)
    return
  }
  const bounds = new window.google.maps.LatLngBounds()
  locatedActivities.forEach((activity) => bounds.extend({ lat: activity.lat, lng: activity.lng }))
  if (locatedActivities.length === 1) {
    map.setCenter(bounds.getCenter())
    map.setZoom(14)
  } else {
    map.fitBounds(bounds, 48)
  }
}

defineExpose({ focusActivity, focusLocation, resetMap })

watch(() => props.activities, updateActivityMarkers, { deep: true })
watch(() => props.selectedId, updateActivityMarkers)
watch(() => [props.draftLocation, props.picking], updateDraftMarker, { deep: true })

onMounted(async () => {
  if (!API_KEY) {
    error.value = 'Add VITE_GOOGLE_MAPS_API_KEY to PocketSemester/.env to load Google Maps.'
    return
  }
  try {
    await loadMapsApi()
    await window.google.maps.importLibrary('maps')
    map = new window.google.maps.Map(mapElement.value, {
      center: singapore,
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: false,
      styles: [
        { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
      ],
      gestureHandling: 'greedy',
    })
    activityInfoWindow = new window.google.maps.InfoWindow()
    activityInfoWindow.addListener('closeclick', () => { openActivityId = null })
    clickListener = map.addListener('click', onMapClick)
    updateActivityMarkers()
    updateDraftMarker()
  } catch (loadError) {
    error.value = loadError.message || 'Google Maps could not be loaded.'
  }


})

onBeforeUnmount(() => {
  clearActivityMarkers()
  draftMarker?.setMap(null)
  activityInfoWindow?.close()
  clickListener?.remove()
})
</script>

<template>
  <div class="google-map-shell">
    <div v-if="error" class="map-setup-message" role="status">{{ error }}</div>
    <div v-else ref="mapElement" class="google-map" :class="{ picking }"
      aria-label="Google map of Singapore activities"></div>
    <div v-if="!error" class="map-controls" role="group" aria-label="Map controls">
      <button type="button" class="btn btn-light btn-sm" aria-label="Show Singapore and activity locations"
        @click="resetMap">⟲</button>
    </div>
    <p v-if="picking && !error" class="map-hint">Click the map to set the activity location.</p>
  </div>
</template>

<style scoped>
.google-map-shell {
  position: relative;
  min-height: 300px;
  overflow: hidden;
  border: 1px solid #e9ecf4;
  border-radius: .8rem;
  background: #e9eef6;
}

.google-map {
  width: 100%;
  height: clamp(340px, 52vw, 600px);
}

.google-map.picking {
  cursor: crosshair;
}

.map-setup-message {
  display: grid;
  min-height: 340px;
  padding: 2rem;
  place-items: center;
  color: #4b526f;
  text-align: center;
  background: linear-gradient(135deg, #e8f0fa, #f7f9fd);
}

.map-controls {
  position: absolute;
  top: .75rem;
  right: .75rem;
}

.map-controls .btn {
  width: 2rem;
  height: 2rem;
  padding: 0;
  box-shadow: 0 .2rem .6rem rgb(33 42 92 / 18%);
}

.map-hint {
  position: absolute;
  left: 50%;
  bottom: .75rem;
  transform: translateX(-50%);
  margin: 0;
  padding: .45rem .8rem;
  border-radius: 999px;
  color: #373b83;
  background: #fff;
  box-shadow: 0 .2rem .6rem rgb(33 42 92 / 16%);
}
</style>
