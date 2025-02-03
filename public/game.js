// Socket.io bağlantısını güncelle
const socket = io({
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    path: '/socket.io',
    secure: true,
    query: {
        clientTime: Date.now()
    }
});

// Canvas ve context tanımlamaları
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
const minimapCtx = minimap.getContext('2d');

// Canvas boyutları
canvas.width = window.innerWidth - 20;
canvas.height = window.innerHeight - 20;
minimap.width = 200;
minimap.height = 200;

// Oyun değişkenleri
let playerName = '';
let gameStarted = false;
let bullets = [];
let players = {};
let mouseX = 0;
let mouseY = 0;
const BULLET_SPEED = 15;
const keys = {};

// Takım skorları
const teamScores = {
    turk: 0,
    kurt: 0
};

// Oyuncu istatistikleri
const stats = {
    kills: 0,
    deaths: 0,
    accuracy: 0,
    shotsHit: 0,
    shotsFired: 0
};

// Kill feed sistemi
const killFeed = [];
const KILL_FEED_DURATION = 5000;

// Özel güçler için tuş ve cooldown sistemi ekle
const ABILITIES = {
    turk: {
        name: 'Hızlanma',
        duration: 3000,  // 3 saniye
        cooldown: 10000, // 10 saniye
        lastUsed: 0,
        active: false
    },
    kurt: {
        name: 'Görünmezlik',
        duration: 2000,  // 2 saniye
        cooldown: 15000, // 15 saniye
        lastUsed: 0,
        active: false
    }
};

// Yeniden bağlanma ve durum yönetimi
let reconnecting = false;
let gameState = {
    players: {},
    teamScores: { turk: 0, kurt: 0 },
    obstacles: []
};

// Socket olayları
socket.on('connect', () => {
    console.log('Sunucuya bağlandı, ID:', socket.id);
    if (reconnecting && gameStarted) {
        // Yeniden bağlanma durumunda oyun durumunu geri yükle
        socket.emit('playerJoined', {
            name: playerName,
            team: player.team,
            x: player.x,
            y: player.y,
            angle: player.angle,
            health: player.health,
            score: player.score
        });
    }
    reconnecting = false;
});

socket.on('connect_error', (error) => {
    console.error('Bağlantı hatası:', error);
});

socket.on('error', (error) => {
    console.log('Socket hatası:', error);
});

let player = {
    x: 0,
    y: 0,
    size: 30,
    speed: 6,
    angle: 0,
    health: 100,
    score: 0,
    team: '',
    color: '',
    lastShot: 0,
    reloadTime: 250,
    currentWeapon: 'PISTOL',
    ammo: {
        PISTOL: Infinity,
        RIFLE: 90,
        SHOTGUN: 24
    },
    opacity: 1
};

// Spawn noktalarını güncelle
const spawnPoints = {
    turk: [
        {x: 200, y: 200},
        {x: 300, y: 200},
        {x: 200, y: 300}
    ],
    kurt: [
        {x: canvas.width - 200, y: canvas.height - 200},
        {x: canvas.width - 300, y: canvas.height - 200},
        {x: canvas.width - 200, y: canvas.height - 300}
    ]
};

// Takım renkleri
const teamColors = {
    turk: '#ff4444',
    kurt: '#44ff44'
};

// Bayrak resimleri için base64 kodları
const FLAG_DATA = {
    turk: 'data:image/png;base64,... türk bayrağı base64 kodu ...',
    kurt: 'data:image/png;base64,... kürt bayrağı base64 kodu ...'
};

// Bayrak resimleri için yeni değişkenler
const FLAGS = {
    turk: new Image(),
    kurt: new Image()
};

// Bayrak resimlerini yerel dosyalardan yükle
FLAGS.turk.src = '/images/turk-flag.png';
FLAGS.kurt.src = '/images/kurt-flag.png';

// Bayrakların yüklenmesini bekle
let flagsLoaded = 0;
function onFlagLoad() {
    flagsLoaded++;
    if (flagsLoaded === Object.keys(FLAGS).length) {
        console.log('Tüm bayraklar yüklendi');
    }
}

FLAGS.turk.onload = onFlagLoad;
FLAGS.kurt.onload = onFlagLoad;
FLAGS.turk.onerror = () => console.error('Türk bayrağı yüklenemedi:', FLAGS.turk.src);
FLAGS.kurt.onerror = () => console.error('Kürt bayrağı yüklenemedi:', FLAGS.kurt.src);

function getRandomSpawnPoint(team) {
    const points = spawnPoints[team];
    if (!points || points.length === 0) {
        // Eğer spawn noktaları tanımlı değilse varsayılan noktalar kullan
        return team === 'turk' ? 
            {x: 200, y: 200} : 
            {x: canvas.width - 200, y: canvas.height - 200};
    }
    return points[Math.floor(Math.random() * points.length)];
}

// Engelleri güncelle - daha az ve daha stratejik konumlar
const obstacles = [
    // Orta engeller
    { x: canvas.width/2 - 100, y: canvas.height/2 - 100, width: 200, height: 200, color: '#555' },
    
    // Türk tarafı engeller
    { x: 200, y: 200, width: 100, height: 100, color: '#444' },
    { x: 400, y: 100, width: 50, height: 200, color: '#444' },
    
    // Kürt tarafı engeller
    { x: canvas.width - 300, y: canvas.height - 300, width: 100, height: 100, color: '#444' },
    { x: canvas.width - 450, y: canvas.height - 300, width: 50, height: 200, color: '#444' },
    
    // Yan engeller
    { x: canvas.width/2 - 400, y: canvas.height/2, width: 200, height: 50, color: '#555' },
    { x: canvas.width/2 + 200, y: canvas.height/2, width: 200, height: 50, color: '#555' }
];

// Spawn noktasında engel var mı kontrol et
function isSpawnPointClear(x, y) {
    return !checkObstacleCollision(x, y) && 
           !Object.values(players).some(p => {
               const dx = p.x - x;
               const dy = p.y - y;
               return Math.sqrt(dx * dx + dy * dy) < player.size * 2;
           });
}

// Respawn fonksiyonunu düzelt
function respawnPlayer() {
    const spawnPoint = getRandomSpawnPoint(player.team);
    player.x = spawnPoint.x;
    player.y = spawnPoint.y;
    player.health = 100;
    
    // Spawn olduktan sonra pozisyonu hemen gönder
    socket.emit('playerMove', {
        x: player.x,
        y: player.y,
        angle: player.angle,
        health: player.health,
        score: player.score,
        name: playerName,
        team: player.team,
        color: player.color,
        currentWeapon: player.currentWeapon
    });
}

// Mouse pozisyonunu takip et
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    player.angle = Math.atan2(mouseY - player.y, mouseX - player.x);
});

// WASD ile hareket
document.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === '1') player.currentWeapon = 'PISTOL';
    if (e.key === '2') player.currentWeapon = 'RIFLE';
    if (e.key === '3') player.currentWeapon = 'SHOTGUN';
    if (e.key.toLowerCase() === 'q') {
        useAbility();
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
});

function movePlayer() {
    let newX = player.x;
    let newY = player.y;
    let moved = false;

    if (keys['w'] || keys['arrowup']) {
        newY -= player.speed;
        moved = true;
    }
    if (keys['s'] || keys['arrowdown']) {
        newY += player.speed;
        moved = true;
    }
    if (keys['a'] || keys['arrowleft']) {
        newX -= player.speed;
        moved = true;
    }
    if (keys['d'] || keys['arrowright']) {
        newX += player.speed;
        moved = true;
    }

    // Çapraz hareket hızını normalize et
    if (moved && (keys['w'] || keys['s']) && (keys['a'] || keys['d'])) {
        const diagonal = Math.sqrt(2);
        newX = player.x + (newX - player.x) / diagonal;
        newY = player.y + (newY - player.y) / diagonal;
    }

    // Sınırları kontrol et
    newX = Math.max(player.size/2, Math.min(canvas.width - player.size/2, newX));
    newY = Math.max(player.size/2, Math.min(canvas.height - player.size/2, newY));

    // Çarpışma kontrolü
    if (!checkObstacleCollision(newX, newY)) {
        player.x = newX;
        player.y = newY;
        
        // Pozisyonu güncelle
        socket.emit('playerMove', {
            x: player.x,
            y: player.y,
            angle: player.angle,
            health: player.health,
            score: player.score,
            name: playerName,
            team: player.team,
            color: player.color,
            currentWeapon: player.currentWeapon
        });
    }
}

// Ateş etme fonksiyonunu güncelle
canvas.addEventListener('click', (e) => {
    if (!gameStarted || player.health <= 0) return;
    
    const weapon = WEAPONS[player.currentWeapon];
    const now = Date.now();
    
    if (now - player.lastShot >= weapon.reloadTime && player.ammo[player.currentWeapon] > 0) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        if (player.currentWeapon === 'SHOTGUN') {
            // Pompalı için çoklu mermi
            for (let i = 0; i < weapon.bulletCount; i++) {
                const spread = (Math.random() - 0.5) * 0.3;
                const angle = player.angle + spread;
                
                const bullet = createBullet(angle, weapon);
                socket.emit('shoot', bullet);
            }
        } else {
            const bullet = createBullet(player.angle, weapon);
            socket.emit('shoot', bullet);
        }
        
        player.lastShot = now;
        if (player.currentWeapon !== 'PISTOL') {
            player.ammo[player.currentWeapon]--;
        }
    }
});

function createBullet(angle, weapon) {
    const muzzleLength = 35;
    const startX = player.x + Math.cos(angle) * muzzleLength;
    const startY = player.y + Math.sin(angle) * muzzleLength;
    
    return {
        x: startX,
        y: startY,
        angle: angle,
        speed: weapon.bulletSpeed,
        damage: weapon.damage,
        size: weapon.bulletSize,
        playerId: socket.id,
        team: player.team,
        weaponType: player.currentWeapon
    };
}

// drawPlayer fonksiyonunu güncelle
function drawPlayer(x, y, angle, health, name, color, team, currentWeapon = 'PISTOL', opacity = 1) {
    ctx.globalAlpha = opacity;
    // Gölge
    ctx.save();
    ctx.translate(x + 2, y + 2);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(0, 0, player.size/2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    // Ana çizim
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    
    // Bayraklı gövde
    ctx.save(); // Ekstra save for clipping
    // Daire şeklinde kırpma maskesi oluştur
    ctx.beginPath();
    ctx.arc(0, 0, player.size/2, 0, Math.PI * 2);
    ctx.clip();
    
    // Bayrak resmini çiz
    const flag = FLAGS[team];
    if (flag && flag.complete && flag.naturalHeight !== 0) {
        try {
            ctx.drawImage(
                flag,
                -player.size/2,
                -player.size/2,
                player.size,
                player.size
            );
        } catch (error) {
            ctx.fillStyle = color;
            ctx.fill();
        }
    } else {
        ctx.fillStyle = color;
        ctx.fill();
    }
    ctx.restore(); // Restore clipping
    
    // Silahı çiz (kırpma maskesinin dışında)
    const weapon = WEAPONS[currentWeapon];
    weapon.parts.forEach(part => {
        ctx.fillStyle = part.color;
        ctx.fillRect(part.x, part.y, part.w, part.h);
    });
    
    // Namlu ucu parlaması
    if (Date.now() - player.lastShot < 50) {
        ctx.fillStyle = 'rgba(255,200,0,0.8)';
        ctx.beginPath();
        ctx.arc(weapon.length + weapon.muzzleOffset, 0, 6, 0, Math.PI * 2);
        ctx.fill();
    }
    
    ctx.restore();
    
    // İsim ve can barı (rotasyonsuz)
    ctx.save();
    ctx.translate(x, y);
    
    // İsim
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${name} (${team === 'turk' ? 'Türk' : 'Kürt'})`, 0, -45);
    
    // Can barı
    const healthBarWidth = 50;
    const healthBarHeight = 6;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-healthBarWidth/2, -35, healthBarWidth, healthBarHeight);
    ctx.fillStyle = health > 30 ? '#2ecc71' : '#e74c3c';
    ctx.fillRect(-healthBarWidth/2, -35, (health/100) * healthBarWidth, healthBarHeight);
    
    ctx.restore();
    ctx.globalAlpha = 1;
}

function drawMinimap() {
    minimapCtx.clearRect(0, 0, minimap.width, minimap.height);
    minimapCtx.fillStyle = '#1a1a1a';
    minimapCtx.fillRect(0, 0, minimap.width, minimap.height);
    
    const scale = minimap.width / canvas.width;
    
    // Engelleri çiz
    minimapCtx.fillStyle = '#333';
    obstacles.forEach(obstacle => {
        minimapCtx.fillRect(
            obstacle.x * scale,
            obstacle.y * scale,
            obstacle.width * scale,
            obstacle.height * scale
        );
    });
    
    // Diğer oyuncuları çiz
    Object.values(players).forEach(p => {
        if (p.health > 0) {
            minimapCtx.fillStyle = p.team === player.team ? '#44ff44' : '#ff4444';
            minimapCtx.beginPath();
            minimapCtx.arc(p.x * scale, p.y * scale, 3, 0, Math.PI * 2);
            minimapCtx.fill();
        }
    });
    
    // Ana oyuncuyu çiz
    minimapCtx.fillStyle = '#ffff00';
    minimapCtx.beginPath();
    minimapCtx.arc(player.x * scale, player.y * scale, 4, 0, Math.PI * 2);
    minimapCtx.fill();
}

// HUD'a istatistikleri ekle
function updateHUD() {
    try {
        const healthElement = document.getElementById('health');
        const scoreElement = document.getElementById('score');
        const playerCountElement = document.getElementById('playerCount');
        const weaponElement = document.getElementById('weapon');

        if (healthElement) healthElement.textContent = player.health;
        if (scoreElement) scoreElement.textContent = player.score;
        if (playerCountElement) playerCountElement.textContent = Object.keys(players).length + 1;
        
        // Silah ve özel güç bilgisi
        if (weaponElement) {
            const weapon = WEAPONS[player.currentWeapon];
            const ability = ABILITIES[player.team];
            const cooldownLeft = Math.max(0, ability.cooldown - (Date.now() - ability.lastUsed));
            const abilityText = player.team === 'turk' ? 'Hızlanma' : 'Görünmezlik';
            const abilityStatus = cooldownLeft > 0 ? 
                `Q: ${abilityText} (${Math.ceil(cooldownLeft/1000)}s)` : 
                `Q: ${abilityText} [Hazır]`;
            
            weaponElement.textContent = `${weapon.name} | ${abilityStatus}`;
        }
    } catch (error) {
        console.error('HUD güncelleme hatası:', error);
    }
}

// gameLoop içinde kill feed çizimi
function drawKillFeed() {
    const now = Date.now();
    ctx.save();
    ctx.font = '14px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'right';
    
    killFeed.forEach((kill, index) => {
        const age = now - kill.time;
        const alpha = Math.max(0, 1 - age / KILL_FEED_DURATION);
        ctx.globalAlpha = alpha;
        
        const text = `${kill.killer} ⚔️ ${kill.victim} (${WEAPONS[kill.weapon].name})`;
        ctx.fillText(text, canvas.width - 20, 50 + index * 20);
    });
    ctx.restore();
}

function gameLoop() {
    if (!gameStarted) return;
    
    try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawMap();
        movePlayer();
        
        // Önce diğer oyuncuları çiz
        Object.values(players).forEach(p => {
            if (p && p.name && p.health > 0) {
                drawPlayer(p.x, p.y, p.angle, p.health, p.name, p.color, p.team, p.currentWeapon, p.opacity);
            }
        });
        
        // Sonra ana oyuncuyu çiz
        drawPlayer(player.x, player.y, player.angle, player.health, playerName, player.color, player.team, player.currentWeapon, player.opacity);
        
        // Mermileri çiz
        bullets.forEach(bullet => {
            // Mermi izi efekti
            ctx.fillStyle = 'rgba(255,165,0,0.2)';
            ctx.beginPath();
            ctx.arc(bullet.x, bullet.y, 8, 0, Math.PI * 2);
            ctx.fill();
            
            // Ana mermi
            ctx.fillStyle = 'orange';
            ctx.beginPath();
            ctx.arc(bullet.x, bullet.y, 5, 0, Math.PI * 2);
            ctx.fill();
        });
        
        drawMinimap();
        updateHUD();
        drawKillFeed();
        
        // Özel güç efektleri
        if (ABILITIES[player.team].active) {
            ctx.save();
            if (player.team === 'turk') {
                // Hızlanma efekti
                ctx.strokeStyle = '#ff4444';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(player.x, player.y, player.size + 5, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
        }
        
        requestAnimationFrame(gameLoop);
    } catch (error) {
        console.error('gameLoop hatası:', error);
    }
}

socket.on('currentPlayers', (serverPlayers) => {
    console.log('Mevcut oyuncular alındı:', serverPlayers);
    players = {};
    Object.keys(serverPlayers).forEach(id => {
        if (id !== socket.id) {
            players[id] = serverPlayers[id];
            console.log('Eklenen oyuncu:', serverPlayers[id].name);
        }
    });
});

socket.on('playerJoined', (newPlayer) => {
    console.log('Yeni oyuncu katıldı:', newPlayer.name);
    if (newPlayer.id !== socket.id) {
        players[newPlayer.id] = newPlayer;
    }
});

socket.on('playerMoved', (movedPlayer) => {
    if (movedPlayer.id !== socket.id) {
        players[movedPlayer.id] = movedPlayer;
    }
});

socket.on('playerLeft', (playerId) => {
    console.log('Oyuncu ayrıldı:', playerId);
    delete players[playerId];
});

socket.on('bullets', (serverBullets) => {
    bullets = serverBullets;
});

socket.on('playerHit', (data) => {
    if (data.targetId === socket.id) {
        player.health = data.health;
        // Hasar alındığında ekrana kırmızı flaş efekti
        const flash = document.createElement('div');
        flash.style.position = 'fixed';
        flash.style.top = '0';
        flash.style.left = '0';
        flash.style.width = '100%';
        flash.style.height = '100%';
        flash.style.backgroundColor = 'rgba(255,0,0,0.3)';
        flash.style.pointerEvents = 'none';
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 100);
    } else if (players[data.targetId]) {
        players[data.targetId].health = data.health;
    }
    updateHUD();
});

// Takım skorlarını güncelleme fonksiyonu
function updateTeamScores() {
    const turkScore = document.getElementById('turkScore');
    const kurtScore = document.getElementById('kurtScore');
    
    if (turkScore && kurtScore) {
        turkScore.textContent = teamScores.turk || 0;
        kurtScore.textContent = teamScores.kurt || 0;
        console.log('Takım skorları güncellendi:', teamScores); // Debug için
    }
}

// Takım skoru güncelleme olayını düzelt
socket.on('teamScoreUpdate', (scores) => {
    console.log('Yeni takım skorları alındı:', scores);
    
    const turkScore = document.getElementById('turkScore');
    const kurtScore = document.getElementById('kurtScore');
    
    if (turkScore && kurtScore) {
        turkScore.textContent = scores.turk || 0;
        kurtScore.textContent = scores.kurt || 0;
    }
});

// Bireysel skor güncelleme
socket.on('updateScore', (data) => {
    if (data.playerId === socket.id) {
        player.score = data.score;
    } else if (players[data.playerId]) {
        players[data.playerId].score = data.score;
    }
    updateHUD();
});

// Ölüm olayını güncelle
socket.on('playerDied', (data) => {
    if (data.targetId === socket.id) {
        player.health = 100;
        respawnPlayer();
    } else if (players[data.targetId]) {
        players[data.targetId].health = 100;
    }
});

function startGame() {
    try {
        const nameInput = document.getElementById('playerName');
        const teamSelect = document.getElementById('teamSelect');
        
        if (!nameInput || !teamSelect) {
            console.error('Form elemanları bulunamadı');
            return;
        }
        
        playerName = nameInput.value.trim();
        if (!playerName) {
            alert('Lütfen bir isim girin!');
            return;
        }
        
        player.team = teamSelect.value;
        player.color = teamColors[player.team];
        
        // Spawn pozisyonunu ayarla
        respawnPlayer();
        
        // Oyuncuyu sunucuya bildir
        const playerData = {
            x: player.x,
            y: player.y,
            angle: player.angle,
            health: player.health,
            score: player.score,
            name: playerName,
            team: player.team,
            color: player.color
        };
        
        // Önce oyuncuyu sunucuya kaydet
        socket.emit('playerJoined', playerData);
        
        // Login ekranını gizle
        const loginDiv = document.getElementById('login');
        if (loginDiv) {
            loginDiv.style.display = 'none';
        }
        
        gameStarted = true;
        gameLoop();
        
        console.log('Oyun başlatıldı:', playerData);
    } catch (error) {
        console.error('startGame hatası:', error);
    }
}

// Çarpışma kontrolünü güncelle
function checkObstacleCollision(x, y) {
    // Duvardan uzaklık kontrolü
    const WALL_BUFFER = 5; // Duvardan uzaklaşma mesafesi
    
    return obstacles.some(obstacle => {
        const collision = x + player.size/2 > obstacle.x - WALL_BUFFER &&
               x - player.size/2 < obstacle.x + obstacle.width + WALL_BUFFER &&
               y + player.size/2 > obstacle.y - WALL_BUFFER &&
               y - player.size/2 < obstacle.y + obstacle.height + WALL_BUFFER;
        
        if (collision) {
            // Duvardan uzaklaştırma vektörü hesapla
            const centerX = obstacle.x + obstacle.width/2;
            const centerY = obstacle.y + obstacle.height/2;
            const dx = x - centerX;
            const dy = y - centerY;
            
            // Oyuncuyu duvardan uzaklaştır
            if (Math.abs(dx) > Math.abs(dy)) {
                player.x += dx > 0 ? WALL_BUFFER : -WALL_BUFFER;
            } else {
                player.y += dy > 0 ? WALL_BUFFER : -WALL_BUFFER;
            }
        }
        return collision;
    });
}

// Map çizimi için fonksiyonu güncelle
function drawMap() {
    // Arkaplan
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Izgara çiz
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    
    const gridSize = 50;
    const mapWidth = canvas.width;
    const mapHeight = canvas.height;
    
    // Dikey çizgiler
    for(let x = 0; x < mapWidth; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, mapHeight);
        ctx.stroke();
    }
    
    // Yatay çizgiler
    for(let y = 0; y < mapHeight; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(mapWidth, y);
        ctx.stroke();
    }
    
    // Engelleri çiz
    obstacles.forEach(obstacle => {
        // Gölge efekti
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(obstacle.x + 5, obstacle.y + 5, obstacle.width, obstacle.height);
        
        // Ana engel
        ctx.fillStyle = obstacle.color;
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        
        // Üst kenar highlight
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, 2);
    });
}

// Oyun başlatma olaylarını ekle
window.onload = function() {
    const startButton = document.getElementById('startButton');
    const nameInput = document.getElementById('playerName');
    const loginDiv = document.getElementById('login');

    if (startButton) {
        startButton.onclick = function() {
            const playerName = nameInput.value.trim();
            const teamSelect = document.getElementById('teamSelect');
            
            if (!playerName) {
                alert('Lütfen bir isim girin!');
                return;
            }
            
            if (teamSelect) {
                const team = teamSelect.value;
                if (team) {
                    // Oyunu başlat
                    startGame();
                } else {
                    alert('Lütfen bir takım seçin!');
                }
            }
        };
    }

    if (nameInput) {
        nameInput.onkeypress = function(e) {
            if (e.key === 'Enter') {
                startButton.click();
            }
        };
    }
};

// Silah türlerini güncelle
const WEAPONS = {
    PISTOL: {
        name: 'Tabanca',
        damage: 10,
        reloadTime: 250,
        bulletSpeed: 15,
        bulletSize: 5,
        // Silah görünümü
        length: 25,
        width: 8,
        color: '#333',
        muzzleOffset: 5,
        // İkincil parçalar
        parts: [
            {x: 0, y: 0, w: 15, h: 12, color: '#444'}, // Kabza
            {x: 15, y: -4, w: 25, h: 8, color: '#333'} // Namlu
        ]
    },
    RIFLE: {
        name: 'Tüfek',
        damage: 15,
        reloadTime: 150,
        bulletSpeed: 20,
        bulletSize: 4,
        // Silah görünümü
        length: 45,
        width: 6,
        color: '#2c3e50',
        muzzleOffset: 8,
        // İkincil parçalar
        parts: [
            {x: 0, y: 0, w: 20, h: 14, color: '#34495e'}, // Kabza
            {x: 20, y: -3, w: 45, h: 6, color: '#2c3e50'}, // Namlu
            {x: 25, y: -6, w: 15, h: 4, color: '#34495e'}, // Nişangah
            {x: 15, y: 4, w: 10, h: 8, color: '#34495e'} // Şarjör
        ]
    },
    SHOTGUN: {
        name: 'Pompalı',
        damage: 8,
        reloadTime: 800,
        bulletSpeed: 12,
        bulletSize: 3,
        bulletCount: 5,
        // Silah görünümü
        length: 40,
        width: 10,
        color: '#784421',
        muzzleOffset: 10,
        // İkincil parçalar
        parts: [
            {x: 0, y: 0, w: 25, h: 16, color: '#8B4513'}, // Kabza
            {x: 25, y: -5, w: 40, h: 10, color: '#784421'}, // Namlu
            {x: 35, y: -7, w: 5, h: 14, color: '#8B4513'}, // Nişangah
            {x: 15, y: -8, w: 20, h: 4, color: '#8B4513'} // Üst ray
        ]
    }
};

const POWERUPS = {
    HEALTH: {
        name: 'Can Paketi',
        color: '#2ecc71',
        effect: (player) => {
            player.health = Math.min(100, player.health + 50);
        }
    },
    AMMO: {
        name: 'Mermi Paketi',
        color: '#f1c40f',
        effect: (player) => {
            player.ammo.RIFLE += 30;
            player.ammo.SHOTGUN += 8;
        }
    },
    SPEED: {
        name: 'Hız Artışı',
        color: '#3498db',
        effect: (player) => {
            player.speed *= 1.5;
            setTimeout(() => {
                player.speed /= 1.5;
            }, 5000);
        }
    }
};

// Oyun sonu kontrolü
const GAME_DURATION = 10 * 60 * 1000; // 10 dakika
let gameStartTime = Date.now();

function checkGameEnd() {
    const timeLeft = GAME_DURATION - (Date.now() - gameStartTime);
    if (timeLeft <= 0) {
        showGameEnd();
    }
    return Math.max(0, timeLeft);
}

function showGameEnd() {
    const winner = teamScores.turk > teamScores.kurt ? 'Türk' : 'Kürt';
    const endScreen = document.createElement('div');
    endScreen.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.9);
        padding: 20px;
        border-radius: 10px;
        text-align: center;
        color: white;
    `;
    endScreen.innerHTML = `
        <h2>Oyun Bitti!</h2>
        <p>Kazanan: ${winner} Takımı</p>
        <p>Türk Takımı: ${teamScores.turk}</p>
        <p>Kürt Takımı: ${teamScores.kurt}</p>
        <button onclick="location.reload()">Yeniden Başla</button>
    `;
    document.body.appendChild(endScreen);
}

// Özel güç kullanma fonksiyonu
function useAbility() {
    if (!gameStarted || player.health <= 0) return;
    
    const ability = ABILITIES[player.team];
    const now = Date.now();
    
    if (now - ability.lastUsed >= ability.cooldown) {
        ability.active = true;
        ability.lastUsed = now;
        
        // Özel güç efektini uygula
        if (player.team === 'turk') {
            // Hızlanma
            const originalSpeed = player.speed;
            player.speed *= 2;
            setTimeout(() => {
                player.speed = originalSpeed;
                ability.active = false;
            }, ability.duration);
        } else {
            // Görünmezlik
            player.opacity = 0.2;
            setTimeout(() => {
                player.opacity = 1;
                ability.active = false;
            }, ability.duration);
        }
        
        // Diğer oyunculara bildir
        socket.emit('abilityUsed', {
            team: player.team,
            type: ability.name
        });
    }
}

// Oyuncu öldüğünde
socket.on('playerKilled', (data) => {
    if (data.victimId === socket.id) {
        player.health = 0;
        showDeathScreen();
    }
    
    updateTeamScores(data.teamScores);
    updateKillFeed(data);
});

// Yeniden doğma
socket.on('playerRespawned', (data) => {
    if (data.id === socket.id) {
        player.x = data.x;
        player.y = data.y;
        player.health = data.health;
        hideDeathScreen();
    } else if (players[data.id]) {
        players[data.id].x = data.x;
        players[data.id].y = data.y;
        players[data.id].health = data.health;
    }
});

// Ölüm ekranı
function showDeathScreen() {
    const deathScreen = document.createElement('div');
    deathScreen.id = 'deathScreen';
    deathScreen.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 20px;
        border-radius: 10px;
        text-align: center;
        z-index: 1000;
    `;
    deathScreen.innerHTML = `
        <h2>Öldünüz!</h2>
        <p>3 saniye içinde yeniden doğacaksınız...</p>
    `;
    document.body.appendChild(deathScreen);
}

function hideDeathScreen() {
    const deathScreen = document.getElementById('deathScreen');
    if (deathScreen) {
        deathScreen.remove();
    }
}

// Oyun durumu güncellemesi
socket.on('gameState', (state) => {
    if (!gameStarted) return;
    
    // Sadece diğer oyuncuları güncelle
    const otherPlayers = {};
    Object.entries(state.players).forEach(([id, p]) => {
        if (id !== socket.id) {
            otherPlayers[id] = p;
        }
    });
    
    players = otherPlayers;
    teamScores = state.teamScores;
    updateTeamScores(state.teamScores);
});

// Yeniden bağlanma durumu
socket.on('disconnect', () => {
    console.log('Sunucu bağlantısı koptu');
    reconnecting = true;
    
    // Bağlantı koptuğunu göster
    showConnectionLostScreen();
});

// Bağlantı kopma ekranı
function showConnectionLostScreen() {
    const screen = document.createElement('div');
    screen.id = 'connectionLostScreen';
    screen.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.9);
        color: white;
        padding: 20px;
        border-radius: 10px;
        text-align: center;
        z-index: 1000;
    `;
    screen.innerHTML = `
        <h2>Bağlantı Koptu!</h2>
        <p>Yeniden bağlanmaya çalışılıyor...</p>
    `;
    document.body.appendChild(screen);
}

// Bağlantı yeniden sağlandığında
socket.on('connect', () => {
    const lostScreen = document.getElementById('connectionLostScreen');
    if (lostScreen) lostScreen.remove();
    
    if (reconnecting && gameStarted) {
        socket.emit('playerJoined', {
            name: playerName,
            team: player.team,
            x: player.x,
            y: player.y,
            angle: player.angle,
            health: player.health,
            score: player.score
        });
    }
    reconnecting = false;
}); 