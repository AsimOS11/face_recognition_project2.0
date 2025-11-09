// Global variables
let blazefaceModel = null;
let facemeshModel = null;
let registerStream = null;
let attendanceStream = null;
let modelsLoaded = false;
let isRecognizing = false;
let fpsCounter = 0;
let lastTime = Date.now();

// DOM Elements
const registerBtn = document.getElementById('registerBtn');
const attendanceBtn = document.getElementById('attendanceBtn');
const registerSection = document.getElementById('registerSection');
const attendanceSection = document.getElementById('attendanceSection');
const captureBtn = document.getElementById('captureBtn');
const personNameInput = document.getElementById('personName');
const registerVideo = document.getElementById('registerVideo');
const attendanceVideo = document.getElementById('attendanceVideo');
const registerCanvas = document.getElementById('registerCanvas');
const attendanceCanvas = document.getElementById('attendanceCanvas');
const registerStatus = document.getElementById('registerStatus');
const attendanceStatus = document.getElementById('attendanceStatus');
const recordsContainer = document.getElementById('recordsContainer');
const clearRecordsBtn = document.getElementById('clearRecords');
const modelStatus = document.getElementById('modelStatus');
const faceCount = document.getElementById('faceCount');
const fpsDisplay = document.getElementById('fps');

// Load ultra-fast models (Blazeface + FaceMesh)
async function loadModels() {
    try {
        modelStatus.textContent = 'Loading AI Models...';
        
        // Set TensorFlow.js backend
        await tf.setBackend('webgl');
        await tf.ready();
        
        // Load Blazeface (fastest face detector)
        blazefaceModel = await blazeface.load();
        console.log('✅ Blazeface loaded');
        
        // Load FaceMesh for landmarks
        facemeshModel = await facemesh.load({ maxFaces: 1 });
        console.log('✅ FaceMesh loaded');
        
        modelsLoaded = true;
        modelStatus.textContent = '✅ AI Models Ready - Ultra Fast Mode';
        modelStatus.classList.add('loaded');
        
        updateFaceCount();
    } catch (error) {
        console.error('❌ Error loading models:', error);
        modelStatus.textContent = '❌ Error Loading Models';
        alert('Error loading AI models. Please refresh and check internet connection.');
    }
}

// Initialize
loadModels();
displayAttendanceRecords();

// Event Listeners
registerBtn.addEventListener('click', () => toggleSection('register'));
attendanceBtn.addEventListener('click', () => toggleSection('attendance'));
captureBtn.addEventListener('click', captureFace);
clearRecordsBtn.addEventListener('click', clearAllRecords);

// Toggle sections
function toggleSection(section) {
    if (section === 'register') {
        registerSection.classList.remove('hidden');
        attendanceSection.classList.add('hidden');
        stopStream(attendanceStream);
        attendanceStream = null;
        isRecognizing = false;
        clearCanvas(attendanceCanvas);
        startRegisterCamera();
    } else {
        attendanceSection.classList.remove('hidden');
        registerSection.classList.add('hidden');
        stopStream(registerStream);
        registerStream = null;
        clearCanvas(registerCanvas);
        startAttendanceCamera();
        setTimeout(() => startContinuousRecognition(), 500);
    }
}

// Start register camera
async function startRegisterCamera() {
    try {
        if (registerStream) stopStream(registerStream);
        
        registerStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            } 
        });
        registerVideo.srcObject = registerStream;
        
        await new Promise((resolve) => {
            registerVideo.onloadedmetadata = () => {
                registerVideo.play();
                registerCanvas.width = registerVideo.videoWidth;
                registerCanvas.height = registerVideo.videoHeight;
                resolve();
            };
        });
    } catch (error) {
        showStatus(registerStatus, '❌ Camera access denied', 'error');
    }
}

// Start attendance camera
async function startAttendanceCamera() {
    try {
        if (attendanceStream) stopStream(attendanceStream);
        
        attendanceStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            } 
        });
        attendanceVideo.srcObject = attendanceStream;
        
        await new Promise((resolve) => {
            attendanceVideo.onloadedmetadata = () => {
                attendanceVideo.play();
                attendanceCanvas.width = attendanceVideo.videoWidth;
                attendanceCanvas.height = attendanceVideo.videoHeight;
                resolve();
            };
        });
    } catch (error) {
        showStatus(attendanceStatus, '❌ Camera access denied', 'error');
    }
}

// Stop stream
function stopStream(stream) {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
}

// Clear canvas
function clearCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Extract face features using FaceMesh
async function extractFaceFeatures(videoElement) {
    try {
        // Pass the video element directly
        const predictions = await facemeshModel.estimateFaces(videoElement);
        
        if (predictions.length > 0) {
            const keypoints = predictions[0].scaledMesh;
            
            // Extract key facial points for comparison
            const features = {
                // Eyes
                leftEye: keypoints[33],
                rightEye: keypoints[263],
                // Nose
                noseTip: keypoints[1],
                noseBase: keypoints[168],
                // Mouth
                leftMouth: keypoints[61],
                rightMouth: keypoints[291],
                topLip: keypoints[13],
                bottomLip: keypoints[14],
                // Face outline points
                leftCheek: keypoints[234],
                rightCheek: keypoints[454],
                chin: keypoints[152],
                forehead: keypoints[10]
            };
            
            // Create a feature vector
            const featureVector = Object.values(features).flat();
            return featureVector;
        }
    } catch (error) {
        console.error('Feature extraction error:', error);
    }
    
    return null;
}

// Calculate Euclidean distance between two feature vectors
function calculateDistance(features1, features2) {
    if (!features1 || !features2 || features1.length !== features2.length) {
        return Infinity;
    }
    
    let sum = 0;
    for (let i = 0; i < features1.length; i++) {
        sum += Math.pow(features1[i] - features2[i], 2);
    }
    return Math.sqrt(sum);
}

// Normalize distance to percentage
function distanceToConfidence(distance) {
    // Lower distance = higher confidence
    const maxDistance = 500; // Adjust based on testing
    const confidence = Math.max(0, Math.min(100, 100 - (distance / maxDistance * 100)));
    return Math.round(confidence);
}

// Capture face for registration
async function captureFace() {
    if (!modelsLoaded) {
        showStatus(registerStatus, '⏳ Models still loading...', 'info');
        return;
    }

    const name = personNameInput.value.trim();
    if (!name) {
        showStatus(registerStatus, '⚠️ Please enter a name', 'error');
        personNameInput.focus();
        return;
    }

    if (registerVideo.readyState !== 4) {
        showStatus(registerStatus, '⚠️ Camera not ready', 'error');
        return;
    }

    captureBtn.disabled = true;
    captureBtn.innerHTML = '<span class="btn-icon">⏳</span> Processing...';
    showStatus(registerStatus, '🔍 Detecting face...', 'info');

    try {
        // Detect face with Blazeface - pass video element directly
        const predictions = await blazefaceModel.estimateFaces(registerVideo, false);
        
        if (predictions.length > 0) {
            // Extract features with FaceMesh - pass video element directly
            const features = await extractFaceFeatures(registerVideo);
            
            if (features) {
                // Save face data
                const faceData = {
                    name: name,
                    features: features,
                    timestamp: Date.now()
                };

                let registeredFaces = JSON.parse(localStorage.getItem('registeredFaces') || '[]');
                const existingIndex = registeredFaces.findIndex(f => f.name.toLowerCase() === name.toLowerCase());
                
                if (existingIndex !== -1) {
                    registeredFaces[existingIndex] = faceData;
                    showStatus(registerStatus, `✅ Updated ${name}'s face data!`, 'success');
                } else {
                    registeredFaces.push(faceData);
                    showStatus(registerStatus, `🎉 Registered ${name} successfully!`, 'success');
                }

                localStorage.setItem('registeredFaces', JSON.stringify(registeredFaces));
                personNameInput.value = '';
                updateFaceCount();

                // Draw bounding box
                drawFaceBox(registerCanvas, predictions[0], name, 100);
                setTimeout(() => clearCanvas(registerCanvas), 3000);
            } else {
                showStatus(registerStatus, '❌ Could not extract face features', 'error');
            }
        } else {
            showStatus(registerStatus, '😕 No face detected. Ensure good lighting!', 'error');
        }
    } catch (error) {
        console.error('Capture error:', error);
        showStatus(registerStatus, '❌ Error: ' + error.message, 'error');
    } finally {
        captureBtn.disabled = false;
        captureBtn.innerHTML = '<span class="btn-icon">📸</span> Capture Face';
    }
}

// Start continuous recognition
async function startContinuousRecognition() {
    if (!modelsLoaded) {
        showStatus(attendanceStatus, '⏳ Models loading...', 'info');
        return;
    }

    const registeredFaces = JSON.parse(localStorage.getItem('registeredFaces') || '[]');
    if (registeredFaces.length === 0) {
        showStatus(attendanceStatus, '⚠️ No registered faces. Register first!', 'error');
        return;
    }

    if (attendanceVideo.readyState !== 4) {
        setTimeout(() => startContinuousRecognition(), 500);
        return;
    }

    isRecognizing = true;
    showStatus(attendanceStatus, '🚀 Real-time recognition active!', 'info');
    
    recognizeLoop();
}

// Recognition loop for real-time detection
async function recognizeLoop() {
    if (!isRecognizing || attendanceVideo.readyState !== 4) {
        if (isRecognizing) {
            requestAnimationFrame(recognizeLoop);
        }
        return;
    }

    try {
        // Update FPS
        fpsCounter++;
        const now = Date.now();
        if (now - lastTime >= 1000) {
            fpsDisplay.textContent = fpsCounter;
            fpsCounter = 0;
            lastTime = now;
        }

        // Detect faces - pass video element directly
        const predictions = await blazefaceModel.estimateFaces(attendanceVideo, false);
        clearCanvas(attendanceCanvas);

        if (predictions.length > 0) {
            // Extract features - pass video element directly
            const features = await extractFaceFeatures(attendanceVideo);
            
            if (features) {
                const registeredFaces = JSON.parse(localStorage.getItem('registeredFaces') || '[]');
                let bestMatch = null;
                let minDistance = Infinity;

                // Compare with all registered faces
                for (const face of registeredFaces) {
                    const distance = calculateDistance(features, face.features);
                    if (distance < minDistance) {
                        minDistance = distance;
                        bestMatch = face;
                    }
                }

                const confidence = distanceToConfidence(minDistance);
                const threshold = 60; // Confidence threshold

                if (bestMatch && confidence >= threshold) {
                    drawFaceBox(attendanceCanvas, predictions[0], bestMatch.name, confidence);
                    
                    // Auto-mark attendance if high confidence and not recently marked
                    if (confidence >= 75 && !isRecentlyMarked(bestMatch.name)) {
                        markAttendance(bestMatch.name);
                        showStatus(attendanceStatus, `✅ ${bestMatch.name} - ${confidence}% match!`, 'success');
                        setTimeout(() => {
                            if (isRecognizing) {
                                showStatus(attendanceStatus, '🚀 Real-time recognition active!', 'info');
                            }
                        }, 3000);
                    }
                } else {
                    drawFaceBox(attendanceCanvas, predictions[0], 'Unknown', confidence);
                }
            }
        }
    } catch (error) {
        console.error('Recognition error:', error);
    }

    // Continue loop
    requestAnimationFrame(recognizeLoop);
}

// Check if person was recently marked (within 5 seconds)
function isRecentlyMarked(name) {
    const records = JSON.parse(localStorage.getItem('attendanceRecords') || '[]');
    const fiveSecondsAgo = Date.now() - 5000;
    return records.some(r => r.name === name && r.timestamp > fiveSecondsAgo);
}

// Draw face bounding box
function drawFaceBox(canvas, prediction, label, confidence) {
    const ctx = canvas.getContext('2d');
    const start = prediction.topLeft;
    const end = prediction.bottomRight;
    const size = [end[0] - start[0], end[1] - start[1]];

    // Draw box
    ctx.strokeStyle = confidence >= 75 ? '#43e97b' : confidence >= 60 ? '#fbbf24' : '#ef4444';
    ctx.lineWidth = 3;
    ctx.strokeRect(start[0], start[1], size[0], size[1]);

    // Draw label background
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillRect(start[0], start[1] - 30, size[0], 30);

    // Draw label text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Poppins';
    ctx.fillText(`${label} (${confidence}%)`, start[0] + 5, start[1] - 8);
}

// Mark attendance
function markAttendance(name) {
    const now = new Date();
    const record = {
        id: Date.now(),
        name: name,
        date: now.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        }),
        time: now.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        }),
        timestamp: now.getTime()
    };

    let records = JSON.parse(localStorage.getItem('attendanceRecords') || '[]');
    records.unshift(record);
    localStorage.setItem('attendanceRecords', JSON.stringify(records));
    displayAttendanceRecords();
}

// Display attendance records
function displayAttendanceRecords() {
    const records = JSON.parse(localStorage.getItem('attendanceRecords') || '[]');
    
    if (records.length === 0) {
        recordsContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #999;">
                <div style="font-size: 60px; margin-bottom: 15px;">📋</div>
                <p style="font-size: 18px; font-weight: 500;">No attendance records yet</p>
            </div>
        `;
        return;
    }

    recordsContainer.innerHTML = records.map(record => `
        <div class="record-item">
            <div class="record-info">
                <div class="record-name">👤 ${record.name}</div>
                <div class="record-time">🕐 ${record.time}</div>
                <div class="record-date">📅 ${record.date}</div>
            </div>
        </div>
    `).join('');
}

// Update face count
function updateFaceCount() {
    const faces = JSON.parse(localStorage.getItem('registeredFaces') || '[]');
    faceCount.textContent = faces.length;
}

// Clear all records
function clearAllRecords() {
    if (confirm('Clear all attendance records?')) {
        localStorage.removeItem('attendanceRecords');
        displayAttendanceRecords();
    }
}

// Show status message
function showStatus(element, message, type) {
    element.textContent = message;
    element.className = `status ${type}`;
    element.style.display = 'block';
}

// Cleanup
window.addEventListener('beforeunload', () => {
    isRecognizing = false;
    stopStream(registerStream);
    stopStream(attendanceStream);
});

console.log('⚡ FaceSync Ultra - Lightning Fast Mode Activated!');
