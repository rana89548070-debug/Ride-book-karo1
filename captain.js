// Paste your exact firebase config details here too
const firebaseConfig = {
    apiKey: "AIzaSyAs-YOUR-ACTUAL-API-KEY",
    authDomain: "ride-book-karo-e83fd.firebaseapp.com",
    projectId: "ride-book-karo-e83fd",
    storageBucket: "ride-book-karo-e83fd.appspot.com",
    messagingSenderId: "YOUR-SENDER-ID",
    appId: "YOUR-APP-ID"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

var map = L.map('map').setView([28.9324, 79.4012], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

var routingControl = null;
var currentCaptainId = null;
var targetRideId = null;
var activeFare = 0;

// (Baaki ka captain account registration systems pehle wala hi same rahega)
// Sirf dynamic metrics update handling block ko replace karein:

function listenForAvailableRides() {
    db.collection("rides").where("status", "==", "pending").limit(1)
      .onSnapshot((snapshot) => {
          if(!snapshot.empty && !targetRideId) {
              const rideDoc = snapshot.docs[0];
              const data = rideDoc.data();
              targetRideId = rideDoc.id;
              activeFare = data.fare; // Pulls dynamically generated fare

              // Render job card info transparently inside driver screen
              document.getElementById("job-panel").innerHTML = `
                  <hr>
                  <p style="color:blue; font-weight:bold;">New Ride Request Received!</p>
                  <div class="data-row"><span>Total Trip Distance:</span><strong>${data.distance} km</strong></div>
                  <div class="data-row"><span>Net Cash Collection:</span><strong>${data.fare} Rs</strong></div>
                  <button id="btn-accept" onclick="acceptIncomingRide()">Accept Ride Request</button>
              `;
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

        // UI alterations
        document.getElementById("job-panel").innerHTML = `
            <p>Status: Going to Rider's Pickup Point</p>
            <div id="otp-section">
                <input type="text" id="otp-input" placeholder="Enter Rider's 6-Digit OTP">
                <button onclick="verifyOtpAndStartTrip()">Verify OTP to Begin Trip</button>
            </div>
        `;

        // Telemetry GPS track routing to client location point
        navigator.geolocation.getCurrentPosition((pos) => {
            if (routingControl) map.removeControl(routingControl);
            routingControl = L.Routing.control({
                waypoints: [
                    L.latLng(pos.coords.latitude, pos.coords.longitude),
                    L.latLng(rideData.pickup.lat, rideData.pickup.lng)
                ],
                addWaypoints: false
            }).addTo(map);
        });

    } catch (e) { alert("Network drop error: " + e.message); }
}

async function verifyOtpAndStartTrip() {
    const enteredOtp = document.getElementById("otp-input").value;
    const rideDoc = await db.collection("rides").doc(targetRideId).get();
    const rideData = rideDoc.data();
    
    if (enteredOtp === rideData.otp) {
        await db.collection("rides").doc(targetRideId).update({ status: "ongoing" });
        
        document.getElementById("job-panel").innerHTML = `
            <p style="color:green; font-weight:bold;">Trip Active: Navigating to Destination</p>
            <button onclick="endCurrentTrip()" class="btn-danger">End Ride & Collect ${activeFare} Rs</button>
        `;

        // Clear previous pickup tracking path layer and set target destination tracker
        if (routingControl) map.removeControl(routingControl);
        routingControl = L.Routing.control({
            waypoints: [
                L.latLng(rideData.pickup.lat, rideData.pickup.lng),
                L.latLng(rideData.drop.lat, rideData.drop.lng)
            ],
            addWaypoints: false
        }).addTo(map);
    } else {
        alert("Security Alert: Invalid Authentication Token!");
    }
}

async function endCurrentTrip() {
    const commissionRate = 0.07;
    const cutAmount = activeFare * commissionRate;

    // Direct subtraction engine from current ledger node
    await db.collection("captains").doc(currentCaptainId).update({
        walletBalance: firebase.firestore.FieldValue.increment(-cutAmount)
    });

    await db.collection("admin_analytics").doc("revenue").set({
        totalCommissionEarned: firebase.firestore.FieldValue.increment(cutAmount)
    }, { merge: true });

    await db.collection("rides").doc(targetRideId).update({ status: "completed" });
    
    alert(`Success: Collected ${activeFare} Rs. 7% system allocation fee deducted.`);
    location.reload();
}
