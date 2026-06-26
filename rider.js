const firebaseConfig = {
  apiKey: "AIzaSyBgmr-RNHwzrtvlELXi5OQCFco6hds6o2w",
  authDomain: "ride-book-karo-e83fd.firebaseapp.com",
  databaseURL: "https://ride-book-karo-e83fd-default-rtdb.firebaseio.com",
  projectId: "ride-book-karo-e83fd",
  storageBucket: "ride-book-karo-e83fd.firebasestorage.app",
  messagingSenderId: "132089297625",
  appId: "1:132089297625:web:1cc6b4236b6918312c9cc8"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

var map = L.map('map').setView([28.9324, 79.4012], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

var riderMarker = L.marker([28.9324, 79.4012]).addTo(map).bindPopup("Your Location").openPopup();
var driverMarker = null;
var activeRideId = null;
var driverListener = null;

async function bookNewRide() {
    // 6-digit random OTP generate karna jo driver verify karega
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    
    try {
        const rideRef = await db.collection("rides").add({
            riderName: "Rohit Singh",
            status: "pending",
            pickup: { lat: 28.9324, lng: 79.4012 },
            drop: { lat: 28.9500, lng: 79.4200 },
            fare: 150, // 150 Rs Fixed Fare
            otp: generatedOtp,
            driverId: null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        activeRideId = rideRef.id;
        document.getElementById("active-ride-id").innerText = activeRideId;
        document.getElementById("display-otp").innerText = generatedOtp;
        document.getElementById("booking-form").style.display = "none";
        document.getElementById("ride-info").style.display = "block";

        // Live status listen karna internet se
        listenToRideStatus(activeRideId);

    } catch (error) {
        alert("Internet Error! Booking failed: " + error.message);
    }
}

function listenToRideStatus(rideId) {
    db.collection("rides").doc(rideId).onSnapshot((doc) => {
        const data = doc.data();
        if(!data) return;

        document.getElementById("ride-status").innerText = data.status.toUpperCase();

        if (data.status === "accepted" && data.driverId) {
            // Driver assign ho gya, uska name fetch karo aur live track karo
            fetchDriverDetails(data.driverId);
            startTrackingDriverLive(data.driverId);
        }
        if (data.status === "ongoing") {
            document.getElementById("ride-status").style.backgroundColor = "#007bff";
            document.getElementById("ride-status").style.color = "white";
        }
        if (data.status === "completed") {
            alert("Trip Successfully Completed! Thank you for riding.");
            if(driverListener) driverListener(); // Tracking band karo
            location.reload();
        }
    });
}

async function fetchDriverDetails(driverId) {
    const doc = await db.collection("captains").doc(driverId).get();
    if(doc.exists) {
        document.getElementById("driver-name").innerText = doc.data().name + ` (${doc.data().vehicleNo})`;
    }
}

function startTrackingDriverLive(driverId) {
    // Driver ki location firestore se live stream karna map par
    driverListener = db.collection("captains").doc(driverId).onSnapshot((doc) => {
        const data = doc.data();
        const lat = data.currentLocation.latitude;
        const lng = data.currentLocation.longitude;

        if (driverMarker) {
            driverMarker.setLatLng([lat, lng]);
        } else {
            driverMarker = L.marker([lat, lng], {icon: L.icon({iconUrl: 'https://maps.google.com/mapfiles/ms/icons/cabs.png', iconSize: [35, 35]})}).addTo(map).bindPopup("Captain Is Arriving");
        }
    });
}
