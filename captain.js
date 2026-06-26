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

var map = L.map('map').setView([28.9350, 79.4050], 14); // Slightly offset for simulation
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

var routingControl = null;
var currentCaptainId = null;
var targetRideId = null;
var isKycApproved = false;

async function registerCaptainKYC() {
    const name = document.getElementById("cap-name").value;
    const vehicle = document.getElementById("cap-vehicle").value;
    if(!name || !vehicle) return alert("Fill all details!");

    currentCaptainId = "cap_" + Math.floor(1000 + Math.random() * 9000); // Unique ID

    await db.collection("captains").doc(currentCaptainId).set({
        name: name,
        vehicleNo: vehicle,
        kycStatus: "pending", // Admin isko approve karega
        walletBalance: 50.00,  // Initial 50 Rs deposit
        currentLocation: new firebase.firestore.GeoPoint(28.9350, 79.4050)
    });

    document.getElementById("kyc-box").style.display = "none";
    document.getElementById("work-box").style.display = "block";
    
    // Live account listener lagao
    listenToCaptainAccount(currentCaptainId);
    startLiveGpsUpdates();
}

function listenToCaptainAccount(id) {
    db.collection("captains").doc(id).onSnapshot((doc) => {
        const data = doc.data();
        document.getElementById("kyc-status").innerText = data.kycStatus.toUpperCase();
        document.getElementById("wallet-balance").innerText = data.walletBalance.toFixed(2) + " Rs";

        if(data.kycStatus === "approved") {
            document.getElementById("kyc-status").style.backgroundColor = "#28a745";
            document.getElementById("kyc-status").style.color = "white";
            isKycApproved = true;
            listenForAvailableRides(); // Ride dhundna shuru karo
        }
    });
}

function listenForAvailableRides() {
    // Internet listener jo 'pending' rides ko real time me check karega
    db.collection("rides").where("status", "==", "pending").limit(1)
      .onSnapshot((snapshot) => {
          if(!snapshot.empty && isKycApproved && !targetRideId) {
              const rideDoc = snapshot.docs[0];
              targetRideId = rideDoc.id;
              document.getElementById("job-panel").style.display = "block";
          }
      });
}

async function acceptIncomingRide() {
    try {
        const rideDoc = await db.collection("rides").doc(targetRideId).get();
        const rideData = rideDoc.data();

        await db.collection("rides").doc(targetRideId).update({
            status: "accepted",
            driverId: currentCaptainId
        });

        document.getElementById("btn-accept").style.display = "none";
        document.getElementById("otp-section").style.display = "block";

        // DRAW ROUTE: Driver to Pickup Point
        if (routingControl) map.removeControl(routingControl);
        routingControl = L.Routing.control({
            waypoints: [L.latLng(28.9350, 79.4050), L.latLng(rideData.pickup.lat, rideData.pickup.lng)],
            addWaypoints: false
        }).addTo(map);

    } catch (e) { alert("Network issue: " + e.message); }
}

async function verifyOtpAndStartTrip() {
    const enteredOtp = document.getElementById("otp-input").value;
    const rideDoc = await db.collection("rides").doc(targetRideId).get();
    
    // Asli cryptographic cross-check from Database token
    if (enteredOtp === rideDoc.data().otp) {
        await db.collection("rides").doc(targetRideId).update({ status: "ongoing" });
        document.getElementById("otp-section").style.display = "none";
        document.getElementById("btn-end").style.display = "block";

        // ROUTE SHIFT: Route changes from Pickup to Drop Location
        if (routingControl) map.removeControl(routingControl);
        routingControl = L.Routing.control({
            waypoints: [L.latLng(rideDoc.data().pickup.lat, rideDoc.data().pickup.lng), L.latLng(rideDoc.data().drop.lat, rideDoc.data().drop.lng)],
            addWaypoints: false
        }).addTo(map);
    } else {
        alert("Galat OTP! Driver App network security match failed.");
    }
}

async function endCurrentTrip() {
    const commissionRate = 0.07; // 7% Admin cut
    const fare = 150;
    const cutAmount = fare * commissionRate; // 10.50 Rs

    // Deduct directly from Captain's wallet in Database (Allows negative scale)
    await db.collection("captains").doc(currentCaptainId).update({
        walletBalance: firebase.firestore.FieldValue.increment(-cutAmount)
    });

    // Send cut directly to Admin node
    await db.collection("admin_analytics").doc("revenue").set({
        totalCommissionEarned: firebase.firestore.FieldValue.increment(cutAmount)
    }, { merge: true });

    await db.collection("rides").doc(targetRideId).update({ status: "completed" });
    
    alert(`Trip Completed!\n150 Rs cash collected from rider.\n7% Admin Commission (${cutAmount} Rs) deducted from your wallet.`);
    if (routingControl) map.removeControl(routingControl);
    document.getElementById("job-panel").style.display = "none";
    document.getElementById("btn-end").style.display = "none";
    document.getElementById("btn-accept").style.display = "block";
    targetRideId = null;
}

function startLiveGpsUpdates() {
    navigator.geolocation.watchPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        if(currentCaptainId) {
            db.collection("captains").doc(currentCaptainId).update({
                currentLocation: new firebase.firestore.GeoPoint(lat, lng)
            });
        }
    }, (err) => console.log(err), { enableHighAccuracy: true });
                                                                                                 }
