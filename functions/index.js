const functions = require("firebase-functions");
const admin = require("firebase-admin");
const ytdl = require("ytdl-core");
const cors = require("cors")({ origin: true });

admin.initializeApp();

exports.api = functions.https.onRequest((req, res) => {
    return cors(req, res, async () => {
        // Check if it is the download-youtube endpoint
        // The req.path will vary depending on if it's served via rewrite or direct function URL
        // We'll just check if the query param 'url' exists for now, or use a simple router structure
        // Since we only have one endpoint, we can treat the root of this function as the handler for now,
        // or parse req.path if we need multiple endpoints.

        // For simplicity, we'll assume any request to this function is for downloading
        if (req.method !== 'GET') {
            return res.status(405).send('Method Not Allowed');
        }

        try {
            const videoUrl = req.query.url;

            if (!videoUrl || !ytdl.validateURL(videoUrl)) {
                return res.status(400).json({ error: 'Invalid YouTube URL' });
            }

            console.log(`Downloading: ${videoUrl}`);

            // Get video info to determine format
            const info = await ytdl.getInfo(videoUrl);
            const format = ytdl.chooseFormat(info.formats, { quality: '18' }); // MP4 360p

            if (!format) {
                return res.status(400).json({ error: 'No suitable format found' });
            }

            res.header('Content-Disposition', `attachment; filename="video.mp4"`);
            res.header('Content-Type', 'video/mp4');

            ytdl(videoUrl, { format: format }).pipe(res);

        } catch (err) {
            console.error('Download Error:', err);
            res.status(500).json({ error: 'Failed to download video' });
        }
    });
});
