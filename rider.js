const firebaseConfig = {
  apiKey: "AIzaSyBgmr-RNHwzrtvlELXi5OQCFco6hds6o2w",
  authDomain: "ride-book-karo-e83fd.firebaseapp.com",
  databaseURL: "https://ride-book-karo-e83fd-default-rtdb.firebaseio.com",
  projectId: "ride-book-karo-e83fd",
  storageBucket: "ride-book-karo-e83fd.firebasestorage.app",
  messagingSenderId: "132089297625",
  appId: "1:132089297625:web:1cc6b4236b6918312c9cc8"
};

// Security check helper
if(firebaseConfig.apiKey.includes("YOUR-ACTUAL")) {
    alert("CRITICAL ERROR: Aapne abhi tak apni asli Firebase Configuration keys web console me add nahi ki hain! Buttons kaam nahi karenge.");
}

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Initialize Map onto global coordinates
var map = L.map('map').setView([28.9324, 79.4012], 14); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

var pickupLatLng = null;
var dropLatLng = null;
var pickupMarker = null;
var dropMarker = null;
var driverMarker = null;
var calculatedDistance = 0;
var calculatedFare = 0;
var activeRideId = null;

// ENGINE 1: Mobile Ke GPS Device Se Current Position Ko Pickup Point Banana
navigator.geolocation.getCurrentPosition((position) => {
    var lat = position.coords.latitude;
    var lng = position.coords.longitude;
    
    map.setView([lat, lng], 15);
    pickupLatLng = { lat: lat, lng: lng };
    
    pickupMarker = L.marker([lat, lng], {draggable: true}).addTo(map).bindPopup("Your Location (Pickup)").openPopup();
    
    // Drag handle end to recalculate values
    pickupMarker.on('dragend', function(e) {
        pickupLatLng = e.target.getLatLng();
        recalculateMetrics();
    });
}, (err) => {
    console.log("GPS permission rejected, setting fallback location.");
    pickupLatLng = { lat: 28.9324, lng: 79.4012 };
    pickupMarker = L.marker([28.9324, 79.4012], {draggable: true}).addTo(map).bindPopup("Default Pickup").openPopup();
});

// ENGINE 2: Map Par Click Karke Destination (Drop) Location Choose Karna
map.on('click', function(e) {
    dropLatLng = e.latlng;
    
    if (dropMarker) {
        dropMarker.setLatLng(dropLatLng);
    } else {
        dropMarker = L.marker(dropLatLng, {draggable: true, color: 'red'}).addTo(map).bindPopup("Drop Destination").openPopup();
        
        dropMarker.on('dragend', function(e) {
            dropLatLng = e.target.getLatLng();
            recalculateMetrics();
        });
    }
    recalculateMetrics();
});

// ENGINE 3: Haversine Calculation Script for Real Metrics
function recalculateMetrics() {
    if (!pickupLatLng || !dropLatLng) return;

    const R = 6371; // Earth's radius in km
    const dLat = (dropLatLng.lat - pickupLatLng.lat) * Math.PI / 180;
    const dLon = (dropLatLng.lng - pickupLatLng.lng) * Math.PI / 180;
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(pickupLatLng.lat * Math.PI / 180) * Math.cos(dropLatLng.lat * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
              
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    calculatedDistance = R * c; // Total distance in KM

    // Business Pricing Logic implementation
    calculatedFare = 40 + (calculatedDistance * 12); 
    if(calculatedFare < 40) calculatedFare = 40; // Minimum floor limits

    // Push calculation matrix straight to User Interface
    document.getElementById("ui-distance").innerText = calculatedDistance.toFixed(2) + " km";
    document.getElementById("ui-fare").innerText = calculatedFare.toFixed(0) + " Rs";
    
    // Activate validation to allow booking action
    document.getElementById("btn-book").disabled = false;
    document.getElementById("btn-book").innerText = "Confirm & Request Ride Now";
}

// ENGINE 4: Database Push Logic
async function bookNewRide() {
    if(!pickupLatLng || !dropLatLng) return;
    
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    
    try {
        const rideRef = await db.collection("rides").add({
            riderName: "Rohit Singh",
            status: "pending",
            pickup: { lat: pickupLatLng.lat, lng: pickupLatLng.lng },
            drop: { lat: dropLatLng.lat, lng: dropLatLng.lng },
            distance: calculatedDistance.toFixed(2),
            fare: parseInt(calculatedFare.toFixed(0)),
            otp: generatedOtp,
            driverId: null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        activeRideId = rideRef.id;
        document.getElementById("active-ride-id").innerText = activeRideId;
        document.getElementById("display-otp").innerText = generatedOtp;
        document.getElementById("booking-form").style.display = "none";
        document.getElementById("ride-info").style.display = "block";

        // Listen for realtime streaming network feedback
        listenToRideStatus(activeRideId);

    } catch (error) {
        alert("Firestore Database Cloud Connection Failure: " + error.message);
    }
}

function listenToRideStatus(rideId) {
    db.collection("rides").doc(rideId).onSnapshot((doc) => {
        const data = doc.data();
        if(!data) return;

        document.getElementById("ride-status").innerText = data.status.toUpperCase();

        if (data.status === "accepted" && data.driverId) {
            document.getElementById("driver-name").innerText = "Captain assigned! Pulling tracking telemetry...";
            startTrackingDriverLive(data.driverId);
        }
        if (data.status === "completed") {
            alert(`Ride over! Please pay ${data.fare} Rs to the captain.`);
            location.reload();
        }
    }, (error) => {
        console.error("Snapshot synchronization broken: ", error);
    });
}

function startTrackingDriverLive(driverId) {
    db.collection("captains").doc(driverId).onSnapshot((doc) => {
        const data = doc.data();
        if(!data || !data.currentLocation) return;
        
        const lat = data.currentLocation.latitude;
        const lng = data.currentLocation.longitude;

        if (driverMarker) {
            driverMarker.setLatLng([lat, lng]);
        } else {
            driverMarker = L.marker([lat, lng]).addTo(map).bindPopup("Your Captain is here").openPopup();
        }
    });
}
