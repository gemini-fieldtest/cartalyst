
const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');

const app = express();
const PORT = 3001;

app.use(cors());

// Route to get video stream
app.get('/api/download-youtube', async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl || !ytdl.validateURL(videoUrl)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        console.log(`Downloading: ${videoUrl}`);

        // Get video info to determine format
        const info = await ytdl.getInfo(videoUrl);
        const format = ytdl.chooseFormat(info.formats, { quality: '18' }); // MP4 360p is usually reliable and small enough for AI

        if (!format) {
            return res.status(400).json({ error: 'No suitable format found' });
        }

        res.header('Content-Disposition', `attachment; filename="video.mp4"`);
        res.header('Content-Type', 'video/mp4');

        ytdl(videoUrl, { format: format })
            .pipe(res);

    } catch (err) {
        console.error('Download Error:', err);
        res.status(500).json({ error: 'Failed to download video' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
