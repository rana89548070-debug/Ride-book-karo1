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

// --- 1. KYC SUBMISSION FUNCTION ---
async function SubmitKYC() {
    // HTML se input fields ko unke placeholder ke hisab se dundhna
    const nameInput = document.querySelector('input[placeholder="Full Name"]') || document.getElementById('captain-name');
    const vehicleInput = document.querySelector('input[placeholder*="UK06"]') || document.getElementById('vehicle-number');
    
    if(!nameInput || !vehicleInput || nameInput.value.trim() === "" || vehicleInput.value.trim() === "") {
        alert("Please enter both Name and Vehicle Number!");
        return;
    }

    const captainName = nameInput.value.trim();
    const vehicleNumber = vehicleInput.value.trim();

    try {
        // Button par "Submitting..." dikhana taaki baar-baar click na ho
        const btn = document.querySelector('button[onclick="submitKYC()"]') || document.querySelector('.box button');
        if(btn) btn.innerText = "Submitting...";

        // Cloud Firestore database me data insert karna
        const captainRef = await db.collection("captains").add({
            name: captainName,
            vehicle: vehicleNumber,
            status: "pending",
            walletBalance: 500, // Starting free bonus amount
            currentLocation: new firebase.firestore.GeoPoint(28.9324, 79.4012), // Default location (Rudrapur)
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Unique document ID ko global variable me save karna
        currentCaptainId = captainRef.id;

        // UI par loading panel dikhana aur form ko hide karna
        document.querySelector('.container').innerHTML += `
            <div id="job-panel" class="box" style="margin-top: 15px; border-left: 5px solid #ffc107;">
                <h3 style="color: #333; margin: 0;">Status: ⏳ Waiting for Admin KYC Approval</h3>
                <p style="font-size: 13px; color: #666;">Admin dashboard se approval milte hi aapko rides milna shuru ho jayengi.</p>
            </div>
        `;
        
        if(nameInput.closest('.box')) {
            nameInput.closest('.box').style.display = 'none';
        }

        // Live track karna ki admin ne kab approve kiya
        listenForApproval(currentCaptainId);

    } catch (error) {
        alert("KYC Database Insertion Error: " + error.message);
    }
}

// --- 2. ADMIN APPROVAL LISTENER ---
function listenForApproval(captainId) {
    db.collection("captains").doc(captainId).onSnapshot((doc) => {
        const data = doc.data();
        if (data && data.status === "approved") {
            alert("🎉 Badhai ho! Aapka KYC Approve ho gaya hai. Ab rides milna start ho jayengi.");
            
            const jobPanel = document.getElementById("job-panel");
            if(jobPanel) {
                jobPanel.style.borderLeft = "5px solid #28a745";
                jobPanel.innerHTML = `<h3 style="color: #28a745; margin:0;">🟢 Online: Searching for Rides...</h3>`;
            }
            
            // Background engine start karna rides search karne ke liye
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
              activeFare = data.fare; // Dynamic fare values from cloud

              // Driver screen par ride request ka card generate karna
              document.getElementById("job-panel").innerHTML = `
                  <hr>
                  <p style="color:blue; font-weight:bold; margin:5px 0;">New Ride Request Received!</p>
                  <div style="margin: 8px 0;">Trip Distance: <strong>${data.distance} km</strong></div>
                  <div style="margin: 8px 0;">Net Cash Collection: <strong>${data.fare} Rs</strong></div>
                  <button id="btn-accept" onclick="acceptIncomingRide()" style="background:#28a745; color:white; border:none; padding:10px; width:100%; border-radius:5px; font-weight:bold; cursor:pointer;">Accept Ride Request</button>
              `;
              document.getElementById("job-panel").style.display = "block";
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

        // Screen change karke OTP authentication field dikhana
        document.getElementById("job-panel").innerHTML = `
            <p style="font-weight:bold; color:#ffc107;">Status: Going to Rider's Pickup Point</p>
            <div id="otp-section" style="margin-top:10px;">
                <input type="text" id="otp-input" placeholder="Enter Rider's 6-Digit OTP" style="padding:8px; width:70%; margin-right:5px;">
                <button onclick="verifyOtpAndStartTrip()" style="padding:8px; background:#007bff; color:white; border:none; border-radius:4px;">Verify OTP</button>
            </div>
        `;

        // Telemetry GPS track routing to client pickup location point
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
        alert("Network drop error: " + e.message); 
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
            <p style="color:green; font-weight:bold;">Trip Active: Navigating to Destination</p>
            <button onclick="endCurrentTrip()" class="btn-danger" style="background:#dc3545; color:white; border:none; padding:10px; width:100%; border-radius:5px; font-weight:bold; margin-top:10px; cursor:pointer;">End Ride & Collect ${activeFare} Rs</button>
        `;

        // Clear previous route and setup destination tracker path
        if (routingControl) map.removeControl(routingControl);
        routingControl = L.Routing.control({
            waypoints: [
                L.latLng(rideData.pickup.lat, rideData.pickup.lng),
                L.latLng(rideData.drop.lat, rideData.drop.lng)
            ],
            addWaypoints: false
        }).addTo(map);
    } else {
        alert("Security Alert: Invalid Authentication Token! Sahi OTP dalein.");
    }
}

// --- 6. END TRIP & REVENUE DISTRIBUTION ---
async function endCurrentTrip() {
    const commissionRate = 0.07; // 7% Management platform deduction fee
    const cutAmount = activeFare * commissionRate;

    // Driver account database node se commission subtract karna
    await db.collection("captains").doc(currentCaptainId).update({
        walletBalance: firebase.firestore.FieldValue.increment(-cutAmount)
    });

    // Central cloud panel revenue update karna
    await db.collection("admin_analytics").doc("revenue").set({
        totalCommissionEarned: firebase.firestore.FieldValue.increment(cutAmount)
    }, { merge: true });

    // Ride ko complete flag mark karna
    await db.collection("rides").doc(targetRideId).update({ status: "completed" });
    
    alert(`Success: Collected ${activeFare} Rs cash from Rider. 7% system allocation fee (${cutAmount.toFixed(2)} Rs) deducted from wallet.`);
    location.reload();
}
