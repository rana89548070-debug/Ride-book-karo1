import { db } from './firebase.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const ADMIN_PHONE = '7830722258';
const ADMIN_PASSWORD = 'Rohit@2001';
const DEFAULT_CENTER = [28.6139, 77.2090];
const ridesRef = collection(db, 'rides');

let map;
let pickupMarker;
let dropMarker;
let routeLine;
let pickupCoords = null;
let dropCoords = null;
let rides = [];
let selectedRideId = null;
let captainProfile = null;
let isAdminLoggedIn = false;

const $ = (id) => document.getElementById(id);
const money = (amount) => `₹${Number(amount || 0).toLocaleString('en-IN')}`;

function showToast(message, type = 'info') {
  const toast = $('toast');
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3600);
}

function initMap() {
  map = L.map('map').setView(DEFAULT_CENTER, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  map.on('click', handleMapClick);
}

function handleMapClick(event) {
  if (!pickupCoords) {
    pickupCoords = event.latlng;
    pickupMarker = L.marker(pickupCoords).addTo(map).bindPopup('Pickup').openPopup();
    $('pickup').value = formatLatLng(pickupCoords);
    showToast('Pickup set ho gaya. Ab drop location select karein.');
    return;
  }

  if (!dropCoords) {
    dropCoords = event.latlng;
    dropMarker = L.marker(dropCoords).addTo(map).bindPopup('Drop').openPopup();
    $('drop').value = formatLatLng(dropCoords);
    updateFarePreview();
    showToast('Drop set ho gaya. Ab ride request bhejein.');
  }
}

function formatLatLng(latlng) {
  return `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

function getDistanceKm(start, end) {
  return map.distance(start, end) / 1000;
}

function estimateFare(distanceKm) {
  return Math.max(49, Math.round(29 + distanceKm * 14));
}

function updateFarePreview() {
  if (!pickupCoords || !dropCoords) return;
  const distance = getDistanceKm(pickupCoords, dropCoords);
  const fare = estimateFare(distance);
  $('distanceText').textContent = `${distance.toFixed(2)} km`;
  $('fareText').textContent = money(fare);

  if (routeLine) routeLine.remove();
  routeLine = L.polyline([pickupCoords, dropCoords], { color: '#facc15', weight: 5 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [36, 36] });
}

function resetMapSelection() {
  pickupCoords = null;
  dropCoords = null;
  if (pickupMarker) pickupMarker.remove();
  if (dropMarker) dropMarker.remove();
  if (routeLine) routeLine.remove();
  pickupMarker = null;
  dropMarker = null;
  routeLine = null;
  $('pickup').value = '';
  $('drop').value = '';
  $('distanceText').textContent = '-- km';
  $('fareText').textContent = '₹--';
  map.setView(DEFAULT_CENTER, 12);
}

async function createRide(event) {
  event.preventDefault();
  if (!pickupCoords || !dropCoords) {
    showToast('Pehle map se pickup aur drop select karein.', 'error');
    return;
  }

  const distance = getDistanceKm(pickupCoords, dropCoords);
  const fare = estimateFare(distance);
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const ride = {
    name: $('name').value.trim(),
    phone: $('phone').value.trim(),
    pickup: $('pickup').value,
    drop: $('drop').value,
    pickupCoords: { lat: pickupCoords.lat, lng: pickupCoords.lng },
    dropCoords: { lat: dropCoords.lat, lng: dropCoords.lng },
    payment: $('payment').value,
    note: $('note').value.trim(),
    distance: Number(distance.toFixed(2)),
    fare,
    otp,
    status: 'requested',
    captain: null,
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    await addDoc(ridesRef, ride);
    event.target.reset();
    resetMapSelection();
    showToast(`Ride live request ho gayi. Rider OTP: ${otp}`, 'success');
    location.hash = 'captain';
  } catch (error) {
    showToast(`Firebase write failed: ${error.message}`, 'error');
  }
}

function subscribeToRides() {
  const ridesQuery = query(ridesRef, orderBy('requestedAt', 'desc'));
  onSnapshot(ridesQuery, (snapshot) => {
    rides = snapshot.docs.map((rideDoc) => ({ id: rideDoc.id, ...rideDoc.data() }));
    $('connectionStatus').textContent = 'Firebase live connected hai.';
    renderAll();
  }, (error) => {
    $('connectionStatus').textContent = 'Firebase connection error.';
    showToast(`Firebase read failed: ${error.message}`, 'error');
  });
}

function renderAll() {
  renderHeroStats();
  renderLatestRide();
  renderPendingRequests();
  renderCaptainPanel();
  renderAdminDashboard();
}

function renderHeroStats() {
  $('heroTotalRides').textContent = rides.length;
  $('heroLiveRides').textContent = rides.filter((ride) => ['requested', 'accepted', 'started'].includes(ride.status)).length;
}

function renderLatestRide() {
  const latest = rides[0];
  if (!latest) {
    $('latestRideBox').innerHTML = 'Abhi koi ride request nahi hai.';
    return;
  }
  $('latestRideBox').innerHTML = `
    <div class="timeline-card">
      <span class="status-label ${latest.status}">${latest.status}</span>
      <h3>${latest.name} • ${money(latest.fare)}</h3>
      <p><strong>Pickup:</strong> ${latest.pickup}</p>
      <p><strong>Drop:</strong> ${latest.drop}</p>
      <p><strong>Captain:</strong> ${latest.captain?.name || 'Assign hona baaki'}</p>
    </div>
  `;
}

function renderPendingRequests() {
  const pending = rides.filter((ride) => ride.status === 'requested');
  $('pendingRequests').innerHTML = pending.map((ride) => `
    <article class="queue-card">
      <div>
        <span class="status-label requested">requested</span>
        <h3>${ride.name}</h3>
      </div>
      <p>${ride.pickup} → ${ride.drop}</p>
      <strong>${money(ride.fare)}</strong>
    </article>
  `).join('') || '<div class="empty-state">Abhi koi pending request nahi hai.</div>';
}

function saveCaptain(event) {
  event.preventDefault();
  captainProfile = {
    name: $('captainName').value.trim(),
    phone: $('captainPhone').value.trim(),
    bikeNumber: $('bikeNumber').value.trim()
  };
  selectedRideId = null;
  $('captainBadge').textContent = 'Online';
  $('captainBadge').classList.remove('muted-pill');
  showToast(`${captainProfile.name} online aa gaye.`, 'success');
  renderCaptainPanel();
}

function renderCaptainPanel() {
  $('captainRideCard').classList.add('hidden');
  $('activeRideCard').classList.add('hidden');

  if (!captainProfile) {
    $('captainState').textContent = 'Captain details bhar kar online aayein.';
    return;
  }

  const myActiveRide = rides.find((ride) => ride.captain?.phone === captainProfile.phone && ['accepted', 'started'].includes(ride.status));
  const nextRequest = rides.find((ride) => ride.status === 'requested');
  const ride = myActiveRide || nextRequest;

  if (!ride) {
    $('captainState').textContent = 'Aap online hain. New request ka wait ho raha hai...';
    selectedRideId = null;
    return;
  }

  selectedRideId = ride.id;
  $('captainState').textContent = myActiveRide ? `Aapki ride ${ride.status} status me hai.` : 'New ride request available hai.';

  if (ride.status === 'requested') {
    $('capRider').textContent = `${ride.name} (${ride.phone})`;
    $('capPickup').textContent = ride.pickup;
    $('capDrop').textContent = ride.drop;
    $('capFare').textContent = money(ride.fare);
    $('captainRideCard').classList.remove('hidden');
    return;
  }

  $('captainOtpHint').textContent = ride.otp;
  $('activeRideCard').classList.remove('hidden');
  $('startRideBtn').classList.toggle('hidden', ride.status === 'started');
  $('endRideBtn').classList.toggle('hidden', ride.status !== 'started');
}

async function acceptRide() {
  if (!captainProfile) {
    showToast('Pehle captain online karein.', 'error');
    return;
  }
  if (!selectedRideId) return;

  try {
    await updateDoc(doc(db, 'rides', selectedRideId), {
      status: 'accepted',
      captain: captainProfile,
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    showToast('Ride accept ho gayi. Rider se OTP lein.', 'success');
  } catch (error) {
    showToast(`Ride accept failed: ${error.message}`, 'error');
  }
}

async function startRide() {
  const ride = rides.find((item) => item.id === selectedRideId);
  if (!ride) return;
  if ($('otpInput').value.trim() !== ride.otp) {
    showToast('Invalid OTP. Rider se sahi OTP lein.', 'error');
    return;
  }

  try {
    await updateDoc(doc(db, 'rides', selectedRideId), {
      status: 'started',
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    $('otpInput').value = '';
    showToast('Ride start ho gayi.', 'success');
  } catch (error) {
    showToast(`Ride start failed: ${error.message}`, 'error');
  }
}

async function endRide() {
  if (!selectedRideId) return;
  try {
    await updateDoc(doc(db, 'rides', selectedRideId), {
      status: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    selectedRideId = null;
    showToast('Ride complete ho gayi. Payment collect karein.', 'success');
  } catch (error) {
    showToast(`Ride complete failed: ${error.message}`, 'error');
  }
}

function loginAdmin(event) {
  event.preventDefault();
  const phone = $('adminPhone').value.trim();
  const password = $('adminPassword').value;
  if (phone !== ADMIN_PHONE || password !== ADMIN_PASSWORD) {
    showToast('Admin mobile ya password galat hai.', 'error');
    return;
  }

  isAdminLoggedIn = true;
  $('adminLoginForm').classList.add('hidden');
  $('adminDashboard').classList.remove('hidden');
  showToast('Admin login successful.', 'success');
  renderAdminDashboard();
}

function renderAdminDashboard() {
  if (!isAdminLoggedIn) return;

  const requested = rides.filter((ride) => ride.status === 'requested');
  const completed = rides.filter((ride) => ride.status === 'completed');
  const revenue = completed.reduce((sum, ride) => sum + Number(ride.fare || 0), 0);
  $('totalRides').textContent = rides.length;
  $('requestedRides').textContent = requested.length;
  $('completedRides').textContent = completed.length;
  $('totalRevenue').textContent = money(revenue);
  $('commission').textContent = money(Math.round(revenue * 0.1));
  $('ridesTable').innerHTML = rides.map((ride) => `
    <tr>
      <td>${ride.id.slice(0, 7)}</td>
      <td>${ride.name}<br><small>${ride.phone}</small></td>
      <td>${ride.captain?.name || '--'}<br><small>${ride.captain?.bikeNumber || ''}</small></td>
      <td>${ride.pickup}<br>→ ${ride.drop}</td>
      <td>${money(ride.fare)}<br><small>${ride.payment}</small></td>
      <td><span class="status-label ${ride.status}">${ride.status}</span></td>
      <td><button class="mini-btn" data-delete-id="${ride.id}">Delete</button></td>
    </tr>
  `).join('') || '<tr><td colspan="7">Abhi koi ride nahi hai.</td></tr>';
}

async function deleteRide(rideId) {
  if (!isAdminLoggedIn) return;
  try {
    await deleteDoc(doc(db, 'rides', rideId));
    showToast('Ride delete ho gayi.', 'success');
  } catch (error) {
    showToast(`Delete failed: ${error.message}`, 'error');
  }
}

function handleAdminTableClick(event) {
  const deleteId = event.target.dataset.deleteId;
  if (deleteId) deleteRide(deleteId);
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  subscribeToRides();
  $('rideForm').addEventListener('submit', createRide);
  $('resetMapBtn').addEventListener('click', resetMapSelection);
  $('captainForm').addEventListener('submit', saveCaptain);
  $('acceptRideBtn').addEventListener('click', acceptRide);
  $('startRideBtn').addEventListener('click', startRide);
  $('endRideBtn').addEventListener('click', endRide);
  $('adminLoginForm').addEventListener('submit', loginAdmin);
  $('ridesTable').addEventListener('click', handleAdminTableClick);
});
