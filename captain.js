// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBgmr-RNHwzrtvlELXi5OQCFco6hds6o2w",
  authDomain: "ride-book-karo-e83fd.firebaseapp.com",
  databaseURL: "https://ride-book-karo-e83fd-default-rtdb.firebaseio.com",
  projectId: "ride-book-karo-e83fd",
  storageBucket: "ride-book-karo-e83fd.firebasestorage.app",
  messagingSenderId: "132089297625",
  appId: "1:132089297625:web:1cc6b4236b6918312c9cc8"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Initialize Map
var map = L.map('map').setView([28.9324, 79.4012], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Global Variables
var routingControl = null;
var currentCaptainId = null;
var targetRideId = null;
var activeFare = 0;

// --- 1. KYC SUBMISSION FUNCTION (WITH FIXED VALIDATION & UI MATCH) ---
async function SubmitKYC() {
    // Tumhare captain.html ki exact IDs ko target kiya hai
    const nameInput = document.getElementById('cap-name');
    const vehicleInput = document.getElementById('cap-vehicle');
    
    if(!nameInput || !vehicleInput) {
        alert("System Error: HTML elements not found!");
        return;
    }

    const captainName = nameInput.value.trim();
    const vehicleNumber = vehicleInput.value.trim().toUpperCase(); // Auto Capitalize letters

    if(captainName === "") {
        alert("Please enter your Full Name!");
        return;
    }

    // 🎯 STRICT INDIAN VEHICLE REGEX (FIX FOR FAKE VEHICLES)
    // Yeh format check karega: 2 Letters (State) + 2 Numbers + 1 ya 2 Letters + 4 Numbers (e.g., UK02TB6475)
    const vehicleRegex = /^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$/;
    if(!vehicleRegex.test(vehicleNumber)) {
        alert("🚨 Invalid Vehicle Number! Please enter a valid registration format (e.g., UK02TB6475 or UK06X1111). Random numbers won't work.");
        return;
    }

    try {
        const btn = document.querySelector('#kyc-box button');
        if(btn) btn.innerText = "Submitting to Admin...";

        // Cloud Firestore me entry push karna
        const captainRef = await db.collection("captains").add({
            name: captainName,
            vehicle: vehicleNumber,
            status: "pending",
            walletBalance: 500, // Free welcome bonus
            currentLocation: new firebase.firestore.GeoPoint(28.9324, 79.4012),
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Document ID ko global variable me lena
        currentCaptainId = captainRef.id;

        // HTML elements ko hide/show karna bina layout bigade
        document.getElementById('kyc-box').style.display = 'none';
        document.getElementById('work-box').style.display = 'block';
        document.getElementById('kyc-status').innerText = "⏳ Pending Approval";
        document.getElementById('kyc-status').style.background = "#ffc107";

        // Admin Approval check karna background engine me
        listenForApproval(currentCaptainId);

    } catch (error) {
        alert("KYC Insertion Error: " + error.message);
    }
}

// --- 2. ADMIN APPROVAL LISTENER ---
function listenForApproval(captainId) {
    db.collection("captains").doc(captainId).onSnapshot((doc) => {
        const data = doc.data();
        if (data && data.status === "approved") {
            alert("🎉 Badhai ho! Aapka KYC Approve ho gaya hai. Ab rides milna start ho jayengi.");
            
            document.getElementById('kyc-status').innerText = "🟢 Approved & Online";
            document.getElementById('kyc-status').style.background = "#28a745";
            document.getElementById('wallet-balance').innerText = data.walletBalance.toFixed(2) + " Rs";
            
            // Ride request portal open karna dashboard par
            listenForAvailableRides();
        }
    });
}

// --- 3. LIVE RIDE REQUEST SEARCH ---
function listenForAvailableRides() {
    db.collection("rides").where("status", "==", "pending").limit(1)
      .onSnapshot((snapshot) => {
          if(!snapshot.empty && !targetRideId) {
              const rideDoc = snapshot.docs[0];
              const data = rideDoc.data();
              targetRideId = rideDoc.id;
              activeFare = data.fare;

              // Display target area update inside work-box
              const jobPanel = document.getElementById("job-panel");
              jobPanel.innerHTML = `
                  <hr style="border-color:#444;">
                  <p style="color:#007bff; font-weight:bold; margin:5px 0;">New Ride Request Received!</p>
                  <div class="data-row"><span>Distance:</span><strong>${data.distance} km</strong></div>
                  <div class="data-row"><span>Fare Collection:</span><strong>${data.fare} Rs</strong></div>
                  <button id="btn-accept" onclick="acceptIncomingRide()" style="background:#28a745; color:white; border:none; padding:10px; width:100%; border-radius:5px; font-weight:bold; cursor:pointer; margin-top:10px;">Accept Ride Request</button>
              `;
              jobPanel.style.display = "block";
          }
      });
}

// --- 4. ACCEPT RIDE FUNCTION ---
async function acceptIncomingRide() {
    try {
        const rideDoc = await db.collection("rides").doc(targetRideId).get();
        const rideData = rideDoc.data();

        await db.collection("rides").doc(targetRideId).update({
            status: "accepted",
            driverId: currentCaptainId
        });

        // OTP inputs display logic
        document.getElementById("job-panel").innerHTML = `
            <p style="font-weight:bold; color:#ffc107; margin:5px 0;">Status: Heading to Rider Pickup Point</p>
            <div id="otp-section" style="margin-top:10px; display:flex; gap:5px;">
                <input type="text" id="otp-input" placeholder="Enter Rider's OTP" style="padding:8px; flex:1;">
                <button onclick="verifyOtpAndStartTrip()" style="padding:8px; background:#007bff; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">Verify</button>
            </div>
        `;

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

    } catch (e) { 
        alert("Network Error: " + e.message); 
    }
}

// --- 5. OTP VERIFICATION ENGINE ---
async function verifyOtpAndStartTrip() {
    const enteredOtp = document.getElementById("otp-input").value.trim();
    const rideDoc = await db.collection("rides").doc(targetRideId).get();
    const rideData = rideDoc.data();
    
    if (enteredOtp === rideData.otp) {
        await db.collection("rides").doc(targetRideId).update({ status: "ongoing" });
        
        document.getElementById("job-panel").innerHTML = `
            <p style="color:#28a745; font-weight:bold; margin:5px 0;">Trip Active: Navigating to Drop Location</p>
            <button onclick="endCurrentTrip()" class="btn-danger" style="background:#dc3545; color:white; border:none; padding:10px; width:100%; border-radius:5px; font-weight:bold; margin-top:10px; cursor:pointer;">End Ride & Collect ${activeFare} Rs</button>
        `;

        if (routingControl) map.removeControl(routingControl);
        routingControl = L.Routing.control({
            waypoints: [
                L.latLng(rideData.pickup.lat, rideData.pickup.lng),
                L.latLng(rideData.drop.lat, rideData.drop.lng)
            ],
            addWaypoints: false
        }).addTo(map);
    } else {
        alert("Security Alert: Invalid Authentication OTP!");
    }
}

// --- 6. END TRIP ENGINE ---
async function endCurrentTrip() {
    const commissionRate = 0.07;
    const cutAmount = activeFare * commissionRate;

    await db.collection("captains").doc(currentCaptainId).update({
        walletBalance: firebase.firestore.FieldValue.increment(-cutAmount)
    });

    await db.collection("admin_analytics").doc("revenue").set({
        totalCommissionEarned: firebase.firestore.FieldValue.increment(cutAmount)
    }, { merge: true });

    await db.collection("rides").doc(targetRideId).update({ status: "completed" });
    
    alert(`Success: Collected ${activeFare} Rs cash. 7% Management platform fee (${cutAmount.toFixed(2)} Rs) deducted.`);
    location.reload();
}
