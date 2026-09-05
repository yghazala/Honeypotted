const crypto = require('crypto');
const { createCanvas } = require('canvas');

function generateCode(length = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789';
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function generateCaptchaImage(code) {
  const W = 280, H = 90;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#ff9f43', '#00d2ff'];

  // Background
  ctx.fillStyle = '#161b22';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 6);
  ctx.fill();

  // Noise lines
  for (let i = 0; i < 10; i++) {
    ctx.strokeStyle = colors[Math.floor(Math.random() * colors.length)];
    ctx.lineWidth = Math.random() * 2 + 0.5;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(Math.random() * W, Math.random() * H);
    ctx.lineTo(Math.random() * W, Math.random() * H);
    ctx.stroke();
  }

  // Noise dots
  for (let i = 0; i < 50; i++) {
    ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 2 + 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;

  // Letters
  const charW = W / (code.length + 1);
  for (let i = 0; i < code.length; i++) {
    const x = charW * (i + 0.75) + (Math.random() * 10 - 5);
    const y = H / 2 + 12 + (Math.random() * 16 - 8);
    const rotate = (Math.random() * 40 - 20) * Math.PI / 180;
    const size = Math.floor(Math.random() * 14 + 34);
    const weight = Math.random() > 0.4 ? 'bold' : 'normal';
    ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    ctx.font = `${weight} ${size}px Arial Black, Arial, sans-serif`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotate);
    ctx.fillText(code[i], 0, 0);
    ctx.restore();
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateCode, generateCaptchaImage };