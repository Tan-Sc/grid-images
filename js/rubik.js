// ==========================================
// 1. THREE.JS 3D SCENE SETUP
// ==========================================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 9);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha = true để thấy camera
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
scene.add(ambientLight);

const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight1.position.set(10, 20, 10);
scene.add(dirLight1);

const textureLoader = new THREE.TextureLoader();
const imageUrls = Array.from({ length: 27 }, (_, i) => `https://picsum.photos/seed/${i + 1}/512/512`);

let loadedCount = 0;
const textures = imageUrls.map(url => {
    return textureLoader.load(url, () => {
        loadedCount++;
        if (loadedCount === imageUrls.length) checkLoading();
    });
});

const rubikGroup = new THREE.Group();
const floatGroup = new THREE.Group();
floatGroup.add(rubikGroup);
scene.add(floatGroup);

const cubes = [];
const cubeSize = 0.95;
const offset = 1;

let index = 0;
for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
            const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

            const materials = [];
            for (let i = 0; i < 6; i++) {
                materials.push(new THREE.MeshStandardMaterial({
                    map: textures[index], // Mỗi khối sẽ mang 1 ảnh duy nhất
                    roughness: 0.2,
                    metalness: 0.1
                }));
            }

            const cube = new THREE.Mesh(geometry, materials);

            // --- VỊ TRÍ 1: Khối Rubik ---
            const rubikPos = new THREE.Vector3(x * offset, y * offset, z * offset);

            // --- VỊ TRÍ 2: Lưới Grid (3x9) ---
            const col = index % 9;
            const row = Math.floor(index / 9);
            const gridPos = new THREE.Vector3((col - 4) * 1.2, (1 - row) * 1.2, 0);

            cube.position.copy(rubikPos);
            cube.userData = { rubikPos, gridPos, index };

            const edges = new THREE.EdgesGeometry(geometry);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xdddddd, linewidth: 2 }));
            cube.add(line);

            rubikGroup.add(cube);
            cubes.push(cube);
            index++;
        }
    }
}

// Raycaster cho chế độ Lightbox
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==========================================
// 2. MEDIAPIPE HAND TRACKING & LOGIC
// ==========================================
const videoElement = document.querySelector('.input_video');
const statusBox = document.getElementById('status-box');
const cursorHTML = document.getElementById('cursor');

let isCameraReady = false;
function checkLoading() {
    if (loadedCount === imageUrls.length && isCameraReady) {
        statusBox.innerText = "Sẵn sàng!";
        statusBox.style.background = "#2ecc71";
        setTimeout(() => { statusBox.innerText = "Khối Rubik"; }, 1500);
    }
}

let currentMode = 'rubik'; // 'rubik' | 'grid' | 'lightbox'
let selectedIndex = 13; // Bắt đầu ở giữa lưới
let selectedCube = null;

let targetRotationX = 0;
let targetRotationY = 0;
let targetGridX = 0;

let baseRotationX = 0;
let baseRotationY = 0;
let hasHand = false;

// Swipe Detection Variables
let handXHistory = [];
let swipeCooldown = 0;
const SWIPE_THRESHOLD = 0.12; // Ngưỡng vuốt (vuốt dứt khoát)

// Pinch Zoom Variables
let targetPinchScale = 2.0;

// Phân tích trạng thái bàn tay không xung đột
function detectHandMode(landmarks) {
    const wrist = landmarks[0];
    const tips = [8, 12, 16, 20]; // Trỏ, Giữa, Áp út, Út
    const isFingerOpen = [];

    for (let tipIdx of tips) {
        const tip = landmarks[tipIdx];
        const mcp = landmarks[tipIdx - 2];
        const distTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
        const distMcp = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
        isFingerOpen.push(distTip > distMcp);
    }

    const openCount = isFingerOpen.filter(Boolean).length;

    // 1. 2 ngón (Trỏ + Giữa) -> Lightbox vuốt (Swipe)
    if (isFingerOpen[0] && isFingerOpen[1] && !isFingerOpen[2] && !isFingerOpen[3]) {
        return 'lightbox-swipe';
    }
    // 2. Chỉ ngón trỏ -> Lightbox chạm (Point)
    if (isFingerOpen[0] && !isFingerOpen[1] && !isFingerOpen[2] && !isFingerOpen[3]) {
        return 'lightbox-point';
    }
    // 3. Xòe 3-4 ngón -> Grid
    if (openCount >= 3) {
        return 'grid';
    }
    // 4. Nắm tay (0-1 ngón duỗi) -> Rubik
    if (openCount <= 1) {
        return 'rubik';
    }

    return currentMode; // Fallback giữ nguyên trạng thái cũ tránh rung giật
}

function onResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        hasHand = true;
        const landmarks = results.multiHandLandmarks[0];

        const newMode = detectHandMode(landmarks);

        // Tọa độ ngón trỏ (Dùng cho Raycaster và Swipe)
        const indexTip = landmarks[8];
        const indexX = 1 - indexTip.x;
        const indexY = indexTip.y;
        pointer.x = (indexX * 2) - 1;
        pointer.y = -(indexY * 2) + 1;

        if (newMode !== currentMode) {
            if (newMode.startsWith('lightbox') && currentMode === 'grid') {
                // Khi chuyển từ Grid sang Lightbox, chọn ảnh đang được chỉ vào
                raycaster.setFromCamera(pointer, camera);
                const intersects = raycaster.intersectObjects(cubes);
                if (intersects.length > 0) {
                    selectedIndex = intersects[0].object.userData.index;
                }
            }

            currentMode = newMode;
            if (currentMode === 'rubik') {
                statusBox.innerText = "✊ Khối Rubik";
                statusBox.style.background = "#2ecc71";
                cursorHTML.style.display = 'none';
            } else if (currentMode === 'grid') {
                statusBox.innerText = "✋ Slider Lưới";
                statusBox.style.background = "#e74c3c";
                cursorHTML.style.display = 'none';
            } else if (currentMode === 'lightbox-point') {
                statusBox.innerText = "☝️ 1 Ngón - Chạm đổi ảnh";
                statusBox.style.background = "#f39c12";
                cursorHTML.style.display = 'block';
            } else if (currentMode === 'lightbox-swipe') {
                statusBox.innerText = "✌️ 2 Ngón - Vuốt đổi ảnh";
                statusBox.style.background = "#3498db";
                cursorHTML.style.display = 'none'; // Ẩn con trỏ vì dùng swipe
            }
        }

        // Cập nhật vị trí con trỏ nếu đang ở dạng Point
        if (currentMode === 'lightbox-point') {
            cursorHTML.style.left = (indexX * window.innerWidth) + 'px';
            cursorHTML.style.top = (indexY * window.innerHeight) + 'px';
        }

        // Điều khiển Swipe (Vuốt tay) trong chế độ Lightbox vuốt
        if (currentMode === 'lightbox-swipe') {
            const handCenterVis = 1 - landmarks[9].x; // Dùng lòng bàn tay cho ổn định
            handXHistory.push(handCenterVis);
            if (handXHistory.length > 8) handXHistory.shift();

            if (swipeCooldown > 0) {
                swipeCooldown--;
                if (swipeCooldown === 0) handXHistory = [];
            } else if (handXHistory.length === 8) {
                const deltaX = handXHistory[7] - handXHistory[0];

                if (deltaX < -SWIPE_THRESHOLD) {
                    // Vuốt trái (Next)
                    selectedIndex = Math.min(selectedIndex + 1, cubes.length - 1);
                    swipeCooldown = 25;
                    handXHistory = [];
                } else if (deltaX > SWIPE_THRESHOLD) {
                    // Vuốt phải (Prev)
                    selectedIndex = Math.max(selectedIndex - 1, 0);
                    swipeCooldown = 25;
                    handXHistory = [];
                }
            }
        } else {
            handXHistory = [];
        }

        // Tọa độ lòng bàn tay (Điều khiển Rubik / Grid)
        const handX = landmarks[9].x;
        const handY = landmarks[9].y;

        targetRotationY = -(handX - 0.5) * Math.PI * 4;
        targetRotationX = (handY - 0.5) * Math.PI * 4;
        targetGridX = (handX - 0.5) * 12;

        // --- Xử lý Zoom (Pinch) bằng 2 tay trong chế độ Lightbox ---
        targetPinchScale = 2.0; // Mặc định
        if (currentMode === 'lightbox-point' && results.multiHandLandmarks.length === 2) {
            const tip1 = results.multiHandLandmarks[0][8];
            const tip2 = results.multiHandLandmarks[1][8];
            const dist = Math.hypot(tip1.x - tip2.x, tip1.y - tip2.y);

            targetPinchScale = Math.min(1.0 + (dist * 6.0), 5.5); // Khoảng cách tỉ lệ với độ zoom
            statusBox.innerText = "👐 2 Tay - Kéo Zoom Ảnh";
            statusBox.style.background = "#e74c3c";
        } else if (currentMode === 'lightbox-point') {
            statusBox.innerText = "☝️ 1 Ngón - Chạm đổi ảnh";
            statusBox.style.background = "#f39c12";
        }

    } else {
        hasHand = false;
        cursorHTML.style.display = 'none';
    }
}

const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

hands.onResults(onResults);

const mCamera = new Camera(videoElement, {
    onFrame: async () => { await hands.send({ image: videoElement }); },
    width: 1280,
    height: 720
});

mCamera.start().then(() => {
    isCameraReady = true;
    checkLoading();
});

// ==========================================
// 3. ANIMATION LOOP (LERP & LOGIC)
// ==========================================
const clock = new THREE.Clock();
function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const time = clock.getElapsedTime();

    floatGroup.position.y = Math.sin(time * 2) * 0.15; // Lơ lửng nhẹ

    if (hasHand) {
        if (currentMode === 'rubik') {
            rubikGroup.rotation.y = lerp(rubikGroup.rotation.y, targetRotationY, 0.1);
            rubikGroup.rotation.x = lerp(rubikGroup.rotation.x, targetRotationX, 0.1);
            rubikGroup.position.x = lerp(rubikGroup.position.x, 0, 0.1);
        } else if (currentMode === 'grid') {
            rubikGroup.rotation.y = lerp(rubikGroup.rotation.y, 0, 0.1);
            rubikGroup.rotation.x = lerp(rubikGroup.rotation.x, 0, 0.1);
            rubikGroup.position.x = lerp(rubikGroup.position.x, targetGridX, 0.1);
        } else if (currentMode === 'lightbox-point' || currentMode === 'lightbox-swipe') {

            if (currentMode === 'lightbox-point') {
                // Dùng Raycaster dò khối đang bị chỉ vào
                raycaster.setFromCamera(pointer, camera);
                const intersects = raycaster.intersectObjects(cubes);
                if (intersects.length > 0) {
                    selectedIndex = intersects[0].object.userData.index;
                }
            }

            // Cập nhật selectedCube
            selectedCube = cubes[selectedIndex];

            // Giữ nguyên rotation
            rubikGroup.rotation.y = lerp(rubikGroup.rotation.y, 0, 0.1);
            rubikGroup.rotation.x = lerp(rubikGroup.rotation.x, 0, 0.1);
        }
        baseRotationY = rubikGroup.rotation.y;
        baseRotationX = rubikGroup.rotation.x;
    } else {
        if (currentMode !== 'rubik') {
            currentMode = 'rubik';
            statusBox.innerText = "Khối Rubik";
            statusBox.style.background = "#2ecc71";
            selectedCube = null;
        }

        baseRotationY += delta * 0.4;
        baseRotationX += delta * 0.2;
        rubikGroup.rotation.y = lerp(rubikGroup.rotation.y, baseRotationY, 0.05);
        rubikGroup.rotation.x = lerp(rubikGroup.rotation.x, baseRotationX, 0.05);
        rubikGroup.position.x = lerp(rubikGroup.position.x, 0, 0.05);
    }

    // Xử lý vị trí, kích thước từng ô (Transition mượt mà)
    cubes.forEach(cube => {
        let targetPos = new THREE.Vector3();
        let targetScale = 1;
        let targetAspect = 1;

        if (currentMode === 'rubik') {
            targetPos.copy(cube.userData.rubikPos);
        } else if (currentMode === 'grid') {
            targetPos.copy(cube.userData.gridPos);
        } else if (currentMode === 'lightbox-point' || currentMode === 'lightbox-swipe') {
            if (selectedCube) {
                const diffIndex = cube.userData.index - selectedCube.userData.index;

                const tex = cube.material[0].map;
                if (tex && tex.image && tex.image.width && tex.image.height) {
                    targetAspect = tex.image.width / tex.image.height;
                }

                if (diffIndex === 0) {
                    // Khối được chọn ở giữa, phóng to (Hoặc zoom theo khoảng cách 2 ngón)
                    targetPos.set(-rubikGroup.position.x, 0, 4.5);
                    targetScale = targetPinchScale;
                } else {
                    // Dàn hàng ngang theo thứ tự (Hiệu ứng CoverFlow Carousel)
                    const sign = Math.sign(diffIndex);
                    const absDiff = Math.abs(diffIndex);

                    // Các ảnh xếp hàng sang 2 bên trái/phải theo đúng số thứ tự
                    targetPos.x = -rubikGroup.position.x + sign * (2.8 + absDiff * 1.5 * targetAspect);
                    targetPos.y = 0; // Đưa về cùng một hàng ngang
                    targetPos.z = -absDiff * 0.5; // Xa dần về phía sau
                    targetScale = 0.8;
                }
            } else {
                targetPos.copy(cube.userData.gridPos);
                targetScale = 1;
            }
        }

        cube.position.lerp(targetPos, 0.08);

        // Mở rộng scale cho Cube và điều chỉnh chiều rộng theo aspect ratio
        const currentScaleY = cube.scale.y || 1;
        const nextScale = lerp(currentScaleY, targetScale, 0.1);

        const currentAspect = cube.scale.x / (cube.scale.y || 1);
        const nextAspect = lerp(currentAspect, targetAspect, 0.1);

        cube.scale.set(nextScale * nextAspect, nextScale, nextScale);
    });

    renderer.render(scene, camera);
}

animate();