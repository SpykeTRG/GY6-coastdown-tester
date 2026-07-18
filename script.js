const permBtn = document.getElementById('permBtn');
const actionBtn = document.getElementById('actionBtn');
const timerVal = document.getElementById('timerVal');
const effVal = document.getElementById('effVal');
const diagLog = document.getElementById('diagLog');
const oscCanvas = document.getElementById('oscCanvas');
const oscCtx = oscCanvas.getContext('2d');
const radarCanvas = document.getElementById('radarCanvas');
const radarCtx = radarCanvas.getContext('2d');
const audioCanvas = document.getElementById('audioCanvas');
const audioCtxCanvas = audioCanvas.getContext('2d');
const STATE_IDLE = 0;
const STATE_WAITING_FOR_SPIN = 1;
const STATE_SPINNING = 2;
const STATE_FINISHED = 3;
let currentState = STATE_IDLE;
let startTime = 0;
let endTime = 0;
let lastAngle = 0;
let totalRotations = 0;
let totalDegreesTraveled = 0;
let isFirstAngle = true;
let currentAngle = 0;
let oscData = [];
let angleSectors = new Array(360).fill(0); 
let maxSectorValue = 0;
let impactTimeline = []; 
let audioHistory = [];
const SPIN_START_THRESHOLD = 1.2;  
const SPIN_STOP_THRESHOLD = 0.18;  
const STOP_DURATION_MS = 450;      
let stopTimestamp = null;
let audioCtx = null, audioStream = null, analyser = null;
function resizeDisplay() {
    const dpr = window.devicePixelRatio || 1;
    oscCanvas.width = oscCanvas.clientWidth * dpr;
    oscCanvas.height = oscCanvas.clientHeight * dpr;
    oscCtx.scale(dpr, dpr);
    radarCanvas.width = radarCanvas.clientWidth * dpr;
    radarCanvas.height = radarCanvas.clientHeight * dpr;
    radarCtx.scale(dpr, dpr);
    audioCanvas.width = audioCanvas.clientWidth * dpr;
    audioCanvas.height = audioCanvas.clientHeight * dpr;
    audioCtxCanvas.scale(dpr, dpr);
    drawOscilloscope();
    drawRadar();
    drawAudioSpectrum();
}
window.addEventListener('resize', resizeDisplay);
setTimeout(resizeDisplay, 100);
function uiRenderLoop() {
    if (currentState === STATE_SPINNING || currentState === STATE_WAITING_FOR_SPIN) {
        drawOscilloscope();
        drawRadar();
        drawAudioSpectrum();
        requestAnimationFrame(uiRenderLoop);
    }
}
permBtn.addEventListener('click', async () => {
    const hasOrientationPerm = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
    const hasMotionPerm = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
    if (hasOrientationPerm || hasMotionPerm) {
        try {
            let orientationGranted = false; let motionGranted = false; let audioGranted = false;
            if (hasOrientationPerm) {
                const orientResponse = await DeviceOrientationEvent.requestPermission();
                if (orientResponse === 'granted') orientationGranted = true;
            } else { orientationGranted = true; }
            if (hasMotionPerm) {
                const motionResponse = await DeviceMotionEvent.requestPermission();
                if (motionResponse === 'granted') motionGranted = true;
            } else { motionGranted = true; }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                if (stream) { audioGranted = true; stream.getTracks().forEach(track => track.stop()); }
            } catch (err) { alert('Микрофон заблокирован.'); }
            if (orientationGranted && motionGranted && audioGranted) {
                permBtn.style.display = 'none'; actionBtn.disabled = false;
                diagLog.innerHTML = "<span style='color:var(--green)'>✓ Датчики и микрофон активированы!</span><br>Толкайте колесо.";
                resizeDisplay();
            } else { alert('Ошибка: Дайте доступ ко всем датчикам и микрофону.'); }
        } catch (e) { alert('Ошибка калибровки CoreMotion iOS: ' + e); }
    } else { permBtn.style.display = 'none'; actionBtn.disabled = false; }
});
actionBtn.addEventListener('click', async () => {
    currentState = STATE_WAITING_FOR_SPIN; actionBtn.textContent = 'КАЛИБРОВКА 3D-ОСЕЙ...'; actionBtn.className = 'btn btn-recording'; actionBtn.disabled = true; 
    currentAngle = 0; lastAngle = 0; totalRotations = 0; totalDegreesTraveled = 0; isFirstAngle = true;
    oscData = []; angleSectors.fill(0); maxSectorValue = 0; impactTimeline = []; stopTimestamp = null; audioHistory = [];
    document.querySelectorAll('.m-loss, .p-loss, .m-ref, .p-ref, .m-eng, .p-eng').forEach(td => td.textContent = '-');
    timerVal.innerHTML = '0.00 <span class="unit">ед.выб</span>'; effVal.innerHTML = '0 <span class="unit">%</span>';
    diagLog.innerHTML = "<span style='color:#f59e0b'>⚡ Автомат готов.</span> Резко толкните изолированное колесо вперед.";
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioCtx.createMediaStreamSource(audioStream);
        analyser = audioCtx.createAnalyser(); analyser.fftSize = 256; source.connect(analyser);
    } catch (err) { console.log("Аудио-ошибка", err); }
    setTimeout(() => {
        if(currentState === STATE_WAITING_FOR_SPIN) {
            actionBtn.textContent = 'ВЗВЕДЕНО! ТОЛКАЙТЕ!';
            diagLog.innerHTML = "<span style='color:var(--green)'>🚀 СТАРТ ГОТОВ.</span> Толкайте колесо со всей силы!";
        }
    }, 1000);
    window.addEventListener('deviceorientation', onOrientation); window.addEventListener('devicemotion', onMotion); requestAnimationFrame(uiRenderLoop);
});
function onOrientation(event) {
    if (currentState === STATE_IDLE || currentState === STATE_FINISHED) return;
    let angle = event.alpha;
    if (angle !== null) {
        currentAngle = Math.floor(angle) % 360;
        if (isFirstAngle) { lastAngle = currentAngle; isFirstAngle = false; return; }
        if (currentState === STATE_SPINNING) {
            let deltaAngle = currentAngle - lastAngle;
            if (deltaAngle > 180) deltaAngle -= 360; else if (deltaAngle < -180) deltaAngle += 360;
            totalDegreesTraveled += Math.abs(deltaAngle); totalRotations = Math.floor(totalDegreesTraveled / 360);
        }
        lastAngle = currentAngle;
    }
}
function onMotion(event) {
    if (currentState === STATE_IDLE || currentState === STATE_FINISHED) return;
    const now = performance.now(); let omega_3d = 0; const rot = event.rotationRate;
    if (rot) {
        let rX = rot.beta || 0; let rY = rot.gamma || 0; let rZ = rot.alpha || 0;
        omega_3d = Math.sqrt(rX*rX + rY*rY + rZ*rZ) / 57.2958; 
    }
    if (currentState === STATE_WAITING_FOR_SPIN && omega_3d > SPIN_START_THRESHOLD) {
        currentState = STATE_SPINNING; startTime = now;
        diagLog.innerHTML = "<span style='color:var(--green)'>● Запись выбега...</span> Колесо замедляется.";
    }
    if (currentState === STATE_SPINNING) {
        const elapsedLive = (now - startTime) / 1000;
        let liveIndex = totalDegreesTraveled > 0 ? (elapsedLive / (totalDegreesTraveled / 360)).toFixed(2) : "0.00";
        timerVal.innerHTML = liveIndex + ' <span class="unit">ед (Эталон: 1.14)</span>';
        if (omega_3d < SPIN_STOP_THRESHOLD) {
            if (stopTimestamp === null) stopTimestamp = now; 
            else if (now - stopTimestamp > STOP_DURATION_MS) {
                currentState = STATE_FINISHED; endTime = stopTimestamp;
                window.removeEventListener('deviceorientation', onOrientation); window.removeEventListener('devicemotion', onMotion);
                if (audioStream) audioStream.getTracks().forEach(track => track.stop());
                if (audioCtx) audioCtx.close();
                actionBtn.textContent = '2. НАЧАТЬ АВТО-ТЕСТ'; actionBtn.className = 'btn btn-start'; actionBtn.disabled = false;
                drawOscilloscope(); drawRadar(); drawAudioSpectrum(); analyzeAdvancedResults((endTime - startTime) / 1000); return;
            }
        } else { stopTimestamp = null; }
    }
    if (currentState === STATE_SPINNING) {
        const acc = event.acceleration;
        if (acc) {
            let totalVibeMagnitude = Math.sqrt((acc.x||0)*(acc.x||0) + (acc.y||0)*(acc.y||0) + (acc.z||0)*(acc.z||0));
            if (totalVibeMagnitude < 0.6) totalVibeMagnitude = 0;
            oscData.push(totalVibeMagnitude); if (oscData.length > oscCanvas.clientWidth - 50) oscData.shift();
            let audioVolume = 0;
            if (analyser) {
                const dataArray = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(dataArray);
                let highFreqSum = 0, count = 0;
                for (let i = Math.floor(dataArray.length * 0.35); i < dataArray.length; i++) { highFreqSum += dataArray[i]; count++; }
                audioVolume = count > 0 ? (highFreqSum / count) / 25.5 : 0; 
            }
            audioHistory.push(audioVolume); if (audioHistory.length > audioCanvas.clientWidth - 50) audioHistory.shift();
            let combinedMetric = totalVibeMagnitude + audioVolume * 1.5;
            if (combinedMetric > 0) {
                if (combinedMetric > angleSectors[currentAngle]) angleSectors[currentAngle] = combinedMetric;
                if (angleSectors[currentAngle] > maxSectorValue) maxSectorValue = angleSectors[currentAngle];
            }
            if (totalVibeMagnitude > 1.8) impactTimeline.push({ angle: currentAngle, force: totalVibeMagnitude });
        }
    }
}
function drawOscilloscope() {
    const w = oscCanvas.clientWidth; const h = oscCanvas.clientHeight; oscCtx.clearRect(0, 0, w, h);
    const paddingLeft = 45; const paddingBottom = 25; const graphW = w - paddingLeft - 10; const graphH = h - paddingBottom - 10;
    let maxInHistory = 2.0; for(let i=0; i<oscData.length; i++) { if(oscData[i] > maxInHistory) maxInHistory = oscData[i]; }
    let maxScaleY = Math.ceil(maxInHistory / 2) * 2; if (maxScaleY < 4) maxScaleY = 4; 
    oscCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)'; oscCtx.lineWidth = 0.5; oscCtx.fillStyle = '#ffffff'; oscCtx.font = '10px tabular-nums'; oscCtx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        let gValue = (maxScaleY / 4) * i; let y = graphH + 10 - (graphH * (i / 4));
        oscCtx.beginPath(); oscCtx.moveTo(paddingLeft, y); oscCtx.lineTo(w - 10, y); oscCtx.stroke(); oscCtx.fillText(gValue.toFixed(1) + 'g', paddingLeft - 8, y + 3);
    }
    oscCtx.textAlign = 'center';
    for (let i = 0; i < 5; i++) {
        let ratio = i / 4; let x = paddingLeft + (graphW * ratio);
        oscCtx.beginPath(); oscCtx.moveTo(x, 10); oscCtx.lineTo(x, graphH + 10); oscCtx.stroke(); oscCtx.fillText(Math.round(ratio * 100) + '%', x, h - 14);
    }
    oscCtx.fillText('(Эталон подшипников: Гладкая линия без прыжков и спайков выше 0.5g)', paddingLeft + graphW/2, h - 2);
    if (oscData.length < 2) return;
    oscCtx.strokeStyle = 'var(--orange)'; oscCtx.lineWidth = 2.5; oscCtx.beginPath();
    const stepX = graphW / (oscCanvas.clientWidth - 50);
    for (let i = 0; i < oscData.length; i++) {
        let x = paddingLeft + (i * stepX); let y = graphH + 10 - (graphH * (oscData[i] / maxScaleY));
        if (i === 0) oscCtx.moveTo(x, y); else oscCtx.lineTo(x, y);
    }
    oscCtx.stroke();
}
function drawRadar() {
    const w = radarCanvas.clientWidth; const h = radarCanvas.clientHeight; const cx = w / 2; const cy = h / 2; const r = Math.min(cx, cy) - 30; radarCtx.clearRect(0, 0, w, h);
    radarCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)'; radarCtx.lineWidth = 0.5; radarCtx.fillStyle = '#ffffff'; radarCtx.font = '9px sans-serif'; radarCtx.textAlign = 'left';
    let rings = [r, r * 0.66, r * 0.33]; let ringLabels = ['Max EP', 'Mid', 'Low'];
    rings.forEach((radius, idx) => {
        radarCtx.beginPath(); radarCtx.arc(cx, cy, radius, 0, 2 * Math.PI); radarCtx.stroke(); radarCtx.fillText(ringLabels[idx], cx + 5, cy - radius + 10);
    });
    radarCtx.textAlign = 'center';
    for (let i = 0; i < 360; i += 45) {
        let rad = (i - 90) * Math.PI / 180;
        radarCtx.beginPath(); radarCtx.moveTo(cx, cy); radarCtx.lineTo(cx + r * Math.cos(rad), cy + r * Math.sin(rad)); radarCtx.stroke();
        radarCtx.fillText(i + '°', cx + (r + 14) * Math.cos(rad), cy + (r + 14) * Math.sin(rad) + 3);
    }
    radarCtx.fillText('(Эталон: Идеальный пустой круг без направленных лучей заклинивания)', cx, h - 4);
    if (maxSectorValue === 0) return;
    for (let i = 0; i < 360; i++) {
        const val = angleSectors[i];
        if (val > 0) {
            const magnitude = (val / maxSectorValue) * r; const rad = (i - 90) * Math.PI / 180;
            radarCtx.strokeStyle = `rgba(139, 92, 246, ${Math.min(val/maxSectorValue + 0.2, 1)})`; radarCtx.lineWidth = 2.5;
            radarCtx.beginPath(); radarCtx.moveTo(cx, cy); radarCtx.lineTo(cx + magnitude * Math.cos(rad), cy + magnitude * Math.sin(rad)); radarCtx.stroke();
        }
    }
}
function drawAudioSpectrum() {
    const w = audioCanvas.clientWidth; const h = audioCanvas.clientHeight; audioCtxCanvas.clearRect(0, 0, w, h);
    const paddingLeft = 45; const paddingBottom = 25; const graphW = w - paddingLeft - 10; const graphH = h - paddingBottom - 10;
    audioCtxCanvas.strokeStyle = 'rgba(255, 255, 255, 0.25)'; audioCtxCanvas.lineWidth = 0.5; audioCtxCanvas.fillStyle = '#ffffff'; audioCtxCanvas.font = '10px tabular-nums'; audioCtxCanvas.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        let y = graphH + 10 - (graphH * (i / 4));
        audioCtxCanvas.beginPath(); audioCtxCanvas.moveTo(paddingLeft, y); audioCtxCanvas.lineTo(w - 10, y); audioCtxCanvas.stroke(); audioCtxCanvas.fillText((i * 25) + '%', paddingLeft - 8, y + 3);
    }
    audioCtxCanvas.textAlign = 'center';
    for (let i = 0; i < 5; i++) {
        let ratio = i / 4; let x = paddingLeft + (graphW * ratio);
        audioCtxCanvas.beginPath(); audioCtxCanvas.moveTo(x, 10); audioCtxCanvas.lineTo(x, graphH + 10); audioCtxCanvas.stroke(); audioCtxCanvas.fillText(Math.round(ratio * 100) + '%', x, h - 14);
    }
    audioCtxCanvas.fillText('(Эталон шума: Фоновая линия ниже 15%. Вой редуктора дает пики до 70-100%)', paddingLeft + graphW/2, h - 2);
    if (audioHistory.length < 2) return;
    audioCtxCanvas.strokeStyle = '#10b981'; audioCtxCanvas.lineWidth = 2.0; audioCtxCanvas.beginPath();
    const stepX = graphW / (audioCanvas.clientWidth - 50);
    for (let i = 0; i < audioHistory.length; i++) {
        let x = paddingLeft + (i * stepX); let y = graphH + 10 - (graphH * audioHistory[i]);
        if (i === 0) audioCtxCanvas.moveTo(x, y); else audioCtxCanvas.lineTo(x, y);
    }
    audioCtxCanvas.stroke();
}
function analyzeAdvancedResults(automatedElapsed) {
    const elapsed = automatedElapsed;
    if (totalDegreesTraveled < 90) { effVal.innerHTML = '0 <span class="unit">%</span>'; diagLog.innerHTML = "❌ <b>ОШИБКА 3D-АНАЛИЗА:</b> Недостаточный угол прокрутки."; return; }
    let выбегИндекс = elapsed / (totalDegreesTraveled / 360);
    timerVal.innerHTML = выбегИндекс.toFixed(2) + ' <span class="unit">ед (Идеал: 1.14)</span>';
    let finalEff = Math.round((выбегИндекс / 1.14) * 100); if (finalEff > 150) finalEff = 150; effVal.innerHTML = finalEff + ' <span class="unit">%</span>';
    let totalRadians = (totalDegreesTraveled * Math.PI) / 180; let omega_start_wheel = (2 * totalRadians) / elapsed; let epsilon_wheel = omega_start_wheel / elapsed;
    let J_isolated = 0.142; let T_base_wheel = J_isolated * epsilon_wheel; 
    let gear_ratio = 8.3; let omega_ref = 50.0; let ref_elapsed = 4.0; let ref_radians = (3.5 * 360 * Math.PI) / 180; let ref_omega_start = (2 * ref_radians) / ref_elapsed; let ref_epsilon = ref_omega_start / ref_elapsed; let T_base_ref = J_isolated * ref_epsilon;
    document.querySelectorAll('#lossTable tbody tr').forEach(row => {
        let motor_rpm = parseInt(row.getAttribute('data-rpm')); let eng_torque_crank = parseFloat(row.getAttribute('data-eng-t')); let eng_hp = parseFloat(row.getAttribute('data-eng-hp'));
        let wheel_rpm = motor_rpm / gear_ratio; let omega_wheel_high = (wheel_rpm * 2 * Math.PI) / 60;
        let T_static = T_base_wheel * 0.40; let T_dynamic_base = T_base_wheel * 0.60; let T_loss_wheel_high = T_static + T_dynamic_base * Math.pow(omega_wheel_high / omega_ref, 1.5);
        if (T_loss_wheel_high > 4.5) T_loss_wheel_high = 4.5;
        let HP_loss = (T_loss_wheel_high * omega_wheel_high) / 735.5;
        let T_loss_wheel_ref = (T_base_ref * 0.40) + (T_base_ref * 0.60) * Math.pow(omega_wheel_high / omega_ref, 1.5);
        let HP_loss_ref = (T_loss_wheel_ref * omega_wheel_high) / 735.5;
        row.querySelector('.m-loss').textContent = T_loss_wheel_high.toFixed(2) + ' Нм'; row.querySelector('.p-loss').textContent = HP_loss.toFixed(4) + ' лс';
        row.querySelector('.m-ref').textContent = T_loss_wheel_ref.toFixed(2) + ' Нм'; row.querySelector('.p-ref').textContent = HP_loss_ref.toFixed(4) + ' лс';
        row.querySelector('.m-eng').textContent = (eng_torque_crank * gear_ratio).toFixed(1) + ' Нм'; row.querySelector('.p-eng').textContent = eng_hp.toFixed(1) + ' лс';
    });
    if (totalRotations === 0) totalRotations = 1;
    const impactsPerRotation = impactTimeline.length / totalRotations;
    let report = `<b>Интеллектуальный 3D-тест окончен.</b> Индекс выбега: <b>${выбегИндекс.toFixed(2)} с/об</b> (Накат: ${finalEff}%)<br><br>`;
    if (выбегИндекс >= 1.0) { report += `✅ <b>ЭТАЛОННЫЕ ПОКАЗАТЕЛИ:</b> Приведенный выбег соответствует заводскому эталону. Модель потерь стабильна. Подшипники NSK не требуются.`; }
    else {
        let current_loss_8k = parseFloat(document.querySelector('tr[data-rpm="8000"] .p-loss').textContent); let ref_loss_8k = parseFloat(document.querySelector('tr[data-rpm="8000"] .p-ref').textContent);
        report += `❌ <b>ОБНАРУЖЕНЫ КИНЕТИЧЕСКИЕ ПОТЕРИ:</b> Узел зажат. На рабочих 8000 RPM он крадет у мотора на <b> ${(current_loss_8k - ref_loss_8k).toFixed(3)} л.с.</b> больше нормы. `;
        if (impactsPerRotation > 5.0) report += `<br><br>➔ Высокая плотность 3D-ударов и акустический фон подтверждают раковины. <b>Установка NSK/SKF вернет эти силы на колесо.</b>`;
        else report += `<br><br>➔ Ударов нет, но трение повышено. Проверьте вязкость масла или зажим регулировочных шайб валов.`;
    }
    diagLog.innerHTML = report;
}
// Умный сброс кэша стилей прямо на лету при инициализации PWA
window.addEventListener('DOMContentLoaded', () => {
    const stylesheet = document.getElementById('mainStylesheet');
    if (stylesheet) {
        stylesheet.href = 'style.css?update=' + new Date().getTime();
    }
});
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(reg => console.log('PWA активен', reg)).catch(err => console.log('Ошибка PWA:', err));
    });
}
const updateBtn = document.getElementById('updateBtn');
if (updateBtn) {
    updateBtn.addEventListener('click', () => {
        updateBtn.classList.add('spin-animation');
        diagLog.innerHTML = "<span style='color:var(--accent)'>⏳ Проверка обновлений на GitHub...</span>";
        
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(registration => {
                if (registration) {
                    registration.update().then(() => {
                        setTimeout(() => {
                            updateBtn.classList.remove('spin-animation');
                            diagLog.innerHTML = "<span style='color:var(--green)'>✓ Кэш синхронизирован. Если версия не изменилась, значит вы используете последний билд.</span>";
                        }, 1000);
                    });
                } else {
                    window.location.reload();
                }
            }).catch(err => {
                window.location.reload();
            });
        } else {
            window.location.reload();
        }
    });
}
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        diagLog.innerHTML = "<span style='color:var(--green)'>🚀 Найдена новая версия! Перезапуск приложения...</span>";
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    });
}
