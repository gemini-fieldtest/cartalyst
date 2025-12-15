#!/usr/bin/env node

/**
 * Generate audio clips for racing coach actions using Google Cloud TTS
 *
 * Prerequisites:
 *   1. Enable Cloud Text-to-Speech API: https://console.cloud.google.com/apis/library/texttospeech.googleapis.com
 *   2. Set up authentication: gcloud auth application-default login
 *
 * Usage:
 *   node scripts/generate-audio.js
 *
 * Output:
 *   public/audio/THROTTLE.mp3, public/audio/BRAKE.mp3, etc.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// All action words from coachingService.ts
const ACTIONS = [
  // Braking phase
  'THRESHOLD', 'TRAIL_BRAKE', 'BRAKE', 'WAIT',
  // Corner phase
  'TURN_IN', 'COMMIT', 'ROTATE', 'APEX',
  // Exit phase
  'THROTTLE', 'UNWIND', 'TRACK_OUT', 'PUSH', 'ACCELERATE', 'SEND_IT',
  // Corrections
  'SMOOTH', 'BALANCE', 'NO_COAST', 'EARLY', 'LATE', 'STOP_BEING_A_WUSS',
  // Positive feedback
  'GOOD', 'NICE', 'OPTIMAL',
  // Neutral
  'MAINTAIN', 'STABILIZE'
];

// Voice configuration - Racing engineer style
const VOICE_CONFIG = {
  languageCode: 'en-US',
  name: 'en-US-Neural2-J', // Male, authoritative
  ssmlGender: 'MALE'
};

// Audio configuration
const AUDIO_CONFIG = {
  audioEncoding: 'MP3',
  speakingRate: 1.3,  // Slightly faster for urgency
  pitch: -2.0,        // Lower pitch for authority
  volumeGainDb: 2.0   // Slightly louder
};

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'audio');

async function getAccessToken() {
  try {
    const token = execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
    return token;
  } catch (error) {
    console.error('Failed to get access token. Run: gcloud auth application-default login');
    process.exit(1);
  }
}

function synthesizeSpeech(text, accessToken) {
  return new Promise((resolve, reject) => {
    // Convert underscores to spaces for natural speech
    const spokenText = text.replace(/_/g, ' ');

    const requestBody = JSON.stringify({
      input: { text: spokenText },
      voice: VOICE_CONFIG,
      audioConfig: AUDIO_CONFIG
    });

    const options = {
      hostname: 'texttospeech.googleapis.com',
      path: '/v1/text:synthesize',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        'x-goog-user-project': 'the-need-for-speed'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(data);
            resolve(response.audioContent);
          } catch (e) {
            reject(new Error('Failed to parse response'));
          }
        } else {
          reject(new Error(`API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

async function main() {
  console.log('🎙️  Generating audio clips for racing coach...\n');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const accessToken = await getAccessToken();
  console.log('✓ Got access token\n');

  let successCount = 0;
  let totalSize = 0;

  for (const action of ACTIONS) {
    process.stdout.write(`  Generating ${action.padEnd(15)} ... `);

    try {
      const audioBase64 = await synthesizeSpeech(action, accessToken);
      const audioBuffer = Buffer.from(audioBase64, 'base64');

      const outputPath = path.join(OUTPUT_DIR, `${action}.mp3`);
      fs.writeFileSync(outputPath, audioBuffer);

      const sizeKB = (audioBuffer.length / 1024).toFixed(1);
      totalSize += audioBuffer.length;

      console.log(`✓ ${sizeKB} KB`);
      successCount++;

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));

    } catch (error) {
      console.log(`✗ ${error.message}`);
    }
  }

  console.log('\n' + '─'.repeat(40));
  console.log(`✓ Generated ${successCount}/${ACTIONS.length} clips`);
  console.log(`✓ Total size: ${(totalSize / 1024).toFixed(1)} KB`);
  console.log(`✓ Output: ${OUTPUT_DIR}/`);
  console.log('\nNext: Update coachingService.ts to use these audio files');
}

main().catch(console.error);
