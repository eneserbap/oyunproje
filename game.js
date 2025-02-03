const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = 800;
canvas.height = 600;

const player = {
    x: canvas.width/2,
    y: canvas.height/2,
    size: 30,
    speed: 5,
    color: '#' + Math.floor(Math.random()*16777215).toString(16)
};

const bullets = [];
const players = {};

// Socket.io bağlantısı
const socket = io();

// Oyuncu hareketleri
document.addEventListener('keydown', (e) => {
    switch(e.key) {
        case 'ArrowUp':
            player.y -= player.speed;
            break;
        case 'ArrowDown':
            player.y += player.speed;
            break;
        case 'ArrowLeft':
            player.x -= player.speed;
            break;
        case 'ArrowRight':
            player.x += player.speed;
            break;
    }
    socket.emit('playerMove', { x: player.x, y: player.y });
});

// Ateş etme
document.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const angle = Math.atan2(mouseY - player.y, mouseX - player.x);
    socket.emit('shoot', { x: player.x, y: player.y, angle: angle });
});

// Oyun döngüsü
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Ana oyuncuyu çiz
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.size/2, 0, Math.PI * 2);
    ctx.fill();
    
    // Diğer oyuncuları çiz
    Object.values(players).forEach(p => {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, player.size/2, 0, Math.PI * 2);
        ctx.fill();
    });
    
    requestAnimationFrame(gameLoop);
}

// Socket olayları
socket.on('players', (serverPlayers) => {
    players = serverPlayers;
});

socket.on('newBullet', (bullet) => {
    bullets.push(bullet);
});

gameLoop(); 