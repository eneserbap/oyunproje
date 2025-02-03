require('dotenv').config();

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');

// Statik dosyaları serve et
app.use(express.static(path.join(__dirname, 'public')));

// Ana route için index.html'i gönder
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const players = {};
let bullets = [];

// Engeller dizisini güncelle - daha stratejik bir harita
const obstacles = [
    // Orta bölge engelleri
    { x: 900, y: 400, width: 200, height: 200, color: '#444' }, // Ana merkez blok
    { x: 850, y: 350, width: 300, height: 20, color: '#555' }, // Üst koridor
    { x: 850, y: 630, width: 300, height: 20, color: '#555' }, // Alt koridor
    
    // Türk tarafı engeller
    { x: 200, y: 200, width: 150, height: 20, color: '#444' }, // Üst siper
    { x: 200, y: 400, width: 20, height: 200, color: '#444' }, // Sol dikey duvar
    { x: 400, y: 600, width: 150, height: 20, color: '#444' }, // Alt siper
    
    // Kürt tarafı engeller
    { x: 1650, y: 200, width: 150, height: 20, color: '#444' }, // Üst siper
    { x: 1780, y: 400, width: 20, height: 200, color: '#444' }, // Sağ dikey duvar
    { x: 1450, y: 600, width: 150, height: 20, color: '#444' }, // Alt siper
    
    // Köşe blokları
    { x: 100, y: 100, width: 80, height: 80, color: '#333' },
    { x: 1820, y: 100, width: 80, height: 80, color: '#333' },
    { x: 100, y: 820, width: 80, height: 80, color: '#333' },
    { x: 1820, y: 820, width: 80, height: 80, color: '#333' }
];

// Harita boyutları için sabit değerler
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1500;

// Mermi-engel çarpışma kontrolünü geliştir
function checkBulletObstacleCollision(bullet) {
    return obstacles.some(obstacle => {
        // Mermi boyutunu da hesaba kat
        const bulletRadius = bullet.size || 2;
        
        // Genişletilmiş çarpışma kontrolü
        return (bullet.x - bulletRadius < obstacle.x + obstacle.width &&
                bullet.x + bulletRadius > obstacle.x &&
                bullet.y - bulletRadius < obstacle.y + obstacle.height &&
                bullet.y + bulletRadius > obstacle.y);
    });
}

// Çarpışma kontrolünü güncelle
function checkCollision(bullet, player) {
    const dx = bullet.x - player.x;
    const dy = bullet.y - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < 20; // Çarpışma mesafesini biraz artırdık
}

// Server.js'de global değişkenler ekleyelim
const teamScores = {
    turk: 0,
    kurt: 0
};

// Power-up sistemi
const powerUps = [];
const POWERUP_TYPES = {
    HEALTH: { name: 'Can', color: '#2ecc71', duration: 0 },
    SPEED: { name: 'Hız', color: '#3498db', duration: 5000 },
    DAMAGE: { name: 'Hasar', color: '#e74c3c', duration: 8000 },
    SHIELD: { name: 'Kalkan', color: '#f1c40f', duration: 4000 }
};

const ABILITIES = {
    TURK: {
        SMOKE: {
            name: 'Duman Perdesi',
            duration: 5000,
            cooldown: 15000
        },
        HEAL: {
            name: 'Takım İyileştirme',
            amount: 30,
            radius: 100,
            cooldown: 20000
        }
    },
    KURT: {
        SPEED: {
            name: 'Hızlı Koşu',
            multiplier: 1.5,
            duration: 3000,
            cooldown: 15000
        },
        TRAP: {
            name: 'Tuzak',
            damage: 30,
            duration: 10000,
            cooldown: 20000
        }
    }
};

const MAP_EVENTS = {
    RAIN: {
        name: 'Yağmur',
        effect: 'visibility',
        duration: 30000
    },
    NIGHT: {
        name: 'Gece',
        effect: 'darkness',
        duration: 20000
    },
    STORM: {
        name: 'Fırtına',
        effect: 'movement',
        duration: 15000
    }
};

const ACHIEVEMENTS = {
    FIRST_BLOOD: { name: 'İlk Kan', points: 100 },
    KILLING_SPREE: { name: 'Öldürme Serisi', points: 200 },
    TEAM_PLAYER: { name: 'Takım Oyuncusu', points: 150 },
    SURVIVOR: { name: 'Hayatta Kalan', points: 300 }
};

// Silah türlerini tanımla
const WEAPONS = {
    PISTOL: {
        name: 'Tabanca',
        damage: 10,
        bulletSpeed: 15,
        bulletSize: 5
    },
    RIFLE: {
        name: 'Tüfek',
        damage: 15,
        bulletSpeed: 20,
        bulletSize: 4
    },
    SHOTGUN: {
        name: 'Pompalı',
        damage: 8,
        bulletSpeed: 12,
        bulletSize: 3,
        bulletCount: 5
    }
};

// En üste ekleyin
const LOBBY_ID = 'main_lobby';
let activeGames = new Map();

// Oyuncu yönetimi için yardımcı fonksiyonlar
function respawnPlayer(playerId) {
    if (!players[playerId]) return;
    
    const player = players[playerId];
    const spawnPoint = getRandomSpawnPoint(player.team);
    
    player.health = 100;
    player.x = spawnPoint.x;
    player.y = spawnPoint.y;
    
    // Yeni pozisyonu tüm oyunculara bildir
    io.emit('playerRespawned', {
        id: playerId,
        x: player.x,
        y: player.y,
        health: player.health
    });
}

// Ölüm olayını güncelle
function handlePlayerDeath(targetId, killerId) {
    if (!players[targetId] || !players[killerId]) return;
    
    const killer = players[killerId];
    const victim = players[targetId];
    
    // Skor güncelleme
    if (killer.team === 'turk') {
        teamScores.turk++;
    } else {
        teamScores.kurt++;
    }
    
    killer.score += 10;
    
    // Öldürme bilgisini gönder
    io.emit('playerKilled', {
        killerId: killerId,
        victimId: targetId,
        killerTeam: killer.team,
        killerScore: killer.score,
        teamScores: teamScores
    });
    
    // 3 saniye sonra yeniden doğur
    setTimeout(() => respawnPlayer(targetId), 3000);
}

// Socket bağlantı yönetimini güncelleyelim
io.on('connection', (socket) => {
    console.log('Oyuncu bağlandı:', socket.id);
    
    // Oyuncuyu ana lobiye ekle
    socket.join(LOBBY_ID);
    
    socket.on('playerJoined', (playerData) => {
        try {
            // Oyuncu verilerini kaydet
            players[socket.id] = {
                ...playerData,
                id: socket.id,
                lastUpdate: Date.now(),
                lobbyId: LOBBY_ID
            };
            
            // Tüm oyun durumunu gönder
            const gameState = {
                players: Object.fromEntries(
                    Object.entries(players).filter(([_, p]) => p.lobbyId === LOBBY_ID)
                ),
                teamScores,
                obstacles
            };
            
            // Önce mevcut oyuncuları gönder
            socket.emit('gameState', gameState);
            
            // Sonra diğer oyunculara yeni oyuncuyu bildir
            socket.to(LOBBY_ID).emit('playerJoined', players[socket.id]);
            
            // Takım dengesi kontrolü
            balanceTeams();
            
            console.log(`Oyuncu ${playerData.name} lobiye katıldı. Toplam: ${Object.keys(players).length}`);
        } catch (error) {
            console.error('playerJoined hatası:', error);
        }
    });
    
    // Oyuncu hareketi güncellemesi
    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id] = {
                ...players[socket.id],
                ...data,
                lastUpdate: Date.now()
            };
            // Sadece aynı lobideki oyunculara bildir
            socket.to(LOBBY_ID).emit('playerMoved', players[socket.id]);
        }
    });
    
    socket.on('shoot', (bullet) => {
        if (players[socket.id] && players[socket.id].health > 0) {
            const weapon = WEAPONS[bullet.weaponType || 'PISTOL'];
            const newBullet = {
                ...bullet,
                id: Date.now() + Math.random(),
                playerId: socket.id,
                team: players[socket.id].team,
                speed: weapon.bulletSpeed || 15,
                damage: weapon.damage || 10,
                size: weapon.bulletSize || 2,
                createdAt: Date.now()
            };
            
            // Mermi başlangıç pozisyonunda engel kontrolü
            if (!checkBulletObstacleCollision(newBullet)) {
                bullets.push(newBullet);
                io.emit('newBullet', newBullet);
            }
        }
    });
    
    socket.on('died', (data) => {
        if (players[data.killerId]) {
            io.to(data.killerId).emit('scored');
        }
    });
    
    // Bağlantı koptuğunda
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            console.log('Oyuncu ayrıldı:', players[socket.id].name);
            // Sadece aynı lobidekilere bildir
            socket.to(LOBBY_ID).emit('playerLeft', socket.id);
            delete players[socket.id];
            balanceTeams();
        }
    });

    socket.on('hit', (data) => {
        if (players[data.targetId]) {
            // Oyuncunun canını güncelle
            players[data.targetId].health -= data.damage || 10;
            
            // Eğer oyuncu öldüyse
            if (players[data.targetId].health <= 0) {
                players[data.targetId].health = 100; // Canı yenile
                // Tüm oyunculara ölüm bilgisini gönder
                io.emit('playerDied', {
                    targetId: data.targetId,
                    killerId: data.shooterId
                });
            }
            
            // Tüm oyunculara hasar bilgisini gönder
            io.emit('playerHit', {
                targetId: data.targetId,
                health: players[data.targetId].health
            });
        }
    });

    // Öldürme olayını güncelleyelim
    socket.on('playerDied', (data) => {
        if (players[data.killerId]) {
            // Öldüren oyuncunun takımına puan ekle
            const killerTeam = players[data.killerId].team;
            teamScores[killerTeam]++;
            
            // Tüm oyunculara yeni skor durumunu gönder
            io.emit('teamScoreUpdate', teamScores);
            
            // Öldüren oyuncuya bireysel puan ver
            players[data.killerId].score += 10;
            io.emit('updateScore', {
                playerId: data.killerId,
                score: players[data.killerId].score
            });
        }
    });

    socket.on('useAbility', (abilityName) => {
        const player = players[socket.id];
        if (player && player.health > 0) {
            const ability = ABILITIES[player.team.toUpperCase()][abilityName];
            if (ability) {
                // Yeteneği kullan ve diğer oyunculara bildir
                io.emit('abilityUsed', {
                    playerId: socket.id,
                    ability: abilityName,
                    position: { x: player.x, y: player.y }
                });
            }
        }
    });
});

// Takım dengeleme fonksiyonu
function balanceTeams() {
    const lobbyPlayers = Object.values(players).filter(p => p.lobbyId === LOBBY_ID);
    const turkTeam = lobbyPlayers.filter(p => p.team === 'turk');
    const kurtTeam = lobbyPlayers.filter(p => p.team === 'kurt');
    
    // Takımlar arasında 2'den fazla fark varsa
    if (Math.abs(turkTeam.length - kurtTeam.length) > 2) {
        io.to(LOBBY_ID).emit('teamBalance', {
            turkCount: turkTeam.length,
            kurtCount: kurtTeam.length
        });
    }
}

// Mermi yaşam süresini ve hareket sistemini güncelle
const BULLET_LIFETIME = 3000; // 3 saniye

setInterval(() => {
    const currentTime = Date.now();
    const bulletsToRemove = [];

    bullets.forEach((bullet, index) => {
        // Yaşam süresi kontrolü
        if (currentTime - bullet.createdAt > BULLET_LIFETIME) {
            bulletsToRemove.push(index);
            return;
        }

        // Mermi hareketini güncelle
        const oldX = bullet.x;
        const oldY = bullet.y;
        
        // Küçük adımlarla hareket ettir (daha doğru çarpışma için)
        const steps = 4;
        const stepX = Math.cos(bullet.angle) * bullet.speed / steps;
        const stepY = Math.sin(bullet.angle) * bullet.speed / steps;
        
        let collision = false;
        
        // Mermiyi küçük adımlarla ilerlet
        for (let i = 0; i < steps && !collision; i++) {
            bullet.x += stepX;
            bullet.y += stepY;
            
            if (checkBulletObstacleCollision(bullet)) {
                collision = true;
                bullet.x = oldX;
                bullet.y = oldY;
                bulletsToRemove.push(index);
                break;
            }
        }
        
        if (!collision) {
            // Ekran sınırları kontrolü
            if (bullet.x < -50 || bullet.x > 2050 || bullet.y < -50 || bullet.y > 1050) {
                bulletsToRemove.push(index);
            }
        }
    });

    // Mermileri tersten sil
    bulletsToRemove.sort((a, b) => b - a).forEach(index => {
        bullets.splice(index, 1);
    });

    // Güncel mermi pozisyonlarını gönder
    io.emit('bullets', bullets);
}, 1000/60);

// Power-up oluşturma fonksiyonunu güncelle
setInterval(() => {
    if (powerUps.length < 3) {
        const types = Object.keys(POWERUP_TYPES);
        const type = types[Math.floor(Math.random() * types.length)];
        const powerUp = {
            id: Date.now(),
            type: type,
            x: 100 + Math.random() * (MAP_WIDTH - 200),  // canvas.width yerine MAP_WIDTH
            y: 100 + Math.random() * (MAP_HEIGHT - 200), // canvas.height yerine MAP_HEIGHT
            ...POWERUP_TYPES[type]
        };
        
        // Engellerin üzerine spawn olmasın
        if (!checkObstacleCollision(powerUp)) {
            powerUps.push(powerUp);
            io.emit('powerUpSpawned', powerUp);
        }
    }
}, 15000);

// Her 60 saniyede bir rastgele olay
setInterval(() => {
    const events = Object.keys(MAP_EVENTS);
    const event = events[Math.floor(Math.random() * events.length)];
    const mapEvent = {
        type: event,
        ...MAP_EVENTS[event],
        startTime: Date.now()
    };
    
    io.emit('mapEvent', mapEvent);
}, 60000);

function checkAchievements(player) {
    if (player.kills === 1 && !player.achievements?.FIRST_BLOOD) {
        giveAchievement(player, 'FIRST_BLOOD');
    }
    if (player.kills >= 5 && !player.achievements?.KILLING_SPREE) {
        giveAchievement(player, 'KILLING_SPREE');
    }
    // ... diğer başarım kontrolleri
}

// Spawn noktası fonksiyonu
function getRandomSpawnPoint(team) {
    const spawnPoints = {
        turk: [
            {x: 200, y: 200},
            {x: 300, y: 200},
            {x: 200, y: 300}
        ],
        kurt: [
            {x: MAP_WIDTH - 200, y: MAP_HEIGHT - 200},
            {x: MAP_WIDTH - 300, y: MAP_HEIGHT - 200},
            {x: MAP_WIDTH - 200, y: MAP_HEIGHT - 300}
        ]
    };
    
    const points = spawnPoints[team];
    return points[Math.floor(Math.random() * points.length)];
}

// Engel çarpışma kontrolü
function checkObstacleCollision(object) {
    return obstacles.some(obstacle => {
        return (object.x < obstacle.x + obstacle.width &&
                object.x + (object.width || 20) > obstacle.x &&
                object.y < obstacle.y + obstacle.height &&
                object.y + (object.height || 20) > obstacle.y);
    });
}

// Başarım verme fonksiyonu
function giveAchievement(player, achievementType) {
    if (!player.achievements) {
        player.achievements = {};
    }
    
    player.achievements[achievementType] = true;
    const achievement = ACHIEVEMENTS[achievementType];
    
    io.to(player.id).emit('achievement', {
        name: achievement.name,
        points: achievement.points
    });
}

// Mermi hareketi ve çarpışma kontrolü
setInterval(() => {
    const currentTime = Date.now();
    const bulletsToRemove = [];

    bullets.forEach((bullet, index) => {
        // Yaşam süresi kontrolü
        if (currentTime - bullet.createdAt > 3000) { // 3 saniye
            bulletsToRemove.push(index);
            return;
        }

        // Mermi hareketini güncelle
        bullet.x += Math.cos(bullet.angle) * bullet.speed;
        bullet.y += Math.sin(bullet.angle) * bullet.speed;
        
        // Engel kontrolü
        if (checkBulletObstacleCollision(bullet)) {
            bulletsToRemove.push(index);
            return;
        }
        
        // Oyuncu çarpışma kontrolü
        Object.values(players).forEach(targetPlayer => {
            if (targetPlayer.id !== bullet.playerId && 
                targetPlayer.team !== bullet.team &&
                targetPlayer.health > 0 &&
                checkCollision(bullet, targetPlayer)) {
                
                // Hasar ver
                targetPlayer.health = Math.max(0, targetPlayer.health - bullet.damage);
                
                // Hasar bilgisini gönder
                io.emit('playerHit', {
                    targetId: targetPlayer.id,
                    health: targetPlayer.health,
                    shooterId: bullet.playerId
                });
                
                // Öldürme kontrolü
                if (targetPlayer.health <= 0) {
                    handlePlayerDeath(targetPlayer.id, bullet.playerId);
                }
                
                bulletsToRemove.push(index);
            }
        });
        
        // Ekran sınırları kontrolü
        if (bullet.x < 0 || bullet.x > MAP_WIDTH || bullet.y < 0 || bullet.y > MAP_HEIGHT) {
            bulletsToRemove.push(index);
        }
    });

    // Mermileri sil
    bulletsToRemove.sort((a, b) => b - a).forEach(index => {
        bullets.splice(index, 1);
    });

    io.emit('bullets', bullets);
}, 1000/60);

// Düzenli temizlik ve senkronizasyon
setInterval(() => {
    const now = Date.now();
    
    // Hayalet oyuncuları temizle
    Object.keys(players).forEach(id => {
        if (now - players[id].lastUpdate > 10000) {
            io.to(LOBBY_ID).emit('playerLeft', id);
            delete players[id];
        }
    });
    
    // Eski mermileri temizle - burada hata oluşuyordu
    // bullets = bullets.filter(...) yerine splice kullanın
    const oldBullets = bullets.filter(bullet => now - bullet.createdAt >= 3000);
    oldBullets.forEach(bullet => {
        const index = bullets.indexOf(bullet);
        if (index > -1) {
            bullets.splice(index, 1);
        }
    });
    
    // Oyun durumunu senkronize et
    const gameState = {
        players: Object.fromEntries(
            Object.entries(players).filter(([_, p]) => p.lobbyId === LOBBY_ID)
        ),
        teamScores,
        obstacles
    };
    
    io.to(LOBBY_ID).emit('gameState', gameState);
}, 1000);

// Hata yönetimi
process.on('uncaughtException', (error) => {
    console.error('Kritik hata:', error);
});

io.on('error', (error) => {
    console.error('Socket.io hatası:', error);
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server ${PORT} portunda çalışıyor`);
}); 