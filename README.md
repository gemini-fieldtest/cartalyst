# Cartalyst

**AI-Powered Racing Coach & Driving Performance Optimizer**

[![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6.2-646CFF?logo=vite)](https://vitejs.dev)
[![Gemini](https://img.shields.io/badge/Gemini-AI-4285F4?logo=google)](https://ai.google.dev)

</div>

## Overview

Cartalyst is a real-time racing telemetry application that provides AI-powered coaching feedback to improve your driving performance. It combines GPS-based telemetry simulation with generative AI to deliver actionable coaching advice during live sessions.

## Features

- **Live Telemetry Dashboard** - Real-time visualization of speed, G-forces, throttle, and brake data
- **AI Coaching System** - Multiple coach personas powered by Gemini AI (developed using the customer requirements + Gemini 3.0 [link](https://gemini.google.com/share/983c4a8080ea)):
  - **Tony** - Encouraging, feel-based coaching ("Commit!", "Good hustle!")
  - **Rachel** - Technical physics-focused advice ("Smooth release, balance platform")
  - **AJ** - Direct, actionable commands ("Lat G settling, hammer throttle")
  - **Garmin** - Data-driven delta optimization ("Brake later")
  - **Super AJ** - Adaptive AI that switches personas based on error type
- **Dual AI Architecture**:
  - **Hot Path (Gemini Nano)** - Browser-based instant commands for real-time feedback
  - **Cold Path (Gemini Cloud)** - Detailed analysis and coaching advice
- **Lap Analysis** - Review telemetry data with interactive charts
- **Track Visualization** - GPS-based track rendering with sector breakdowns

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **AI**: Google Gemini (Nano for browser, Cloud API for analysis)
- **Visualization**: Recharts, Google Maps API
- **Telemetry**: GPS-based data processing with G-force calculations

## Getting Started

### Prerequisites

- Node.js (v18+)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/)
- Chrome Canary with Gemini Nano enabled (optional, for hot path)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/cartalyst.git
   cd cartalyst
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your API key:

   Create a `.env.local` file and add:
   ```
   VITE_GEMINI_API_KEY=your_api_key_here
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open http://localhost:5173 in your browser

## Project Structure

```
cartalyst/
├── components/
│   ├── Navbar.tsx          # Navigation bar
│   ├── TelemetryCharts.tsx # Real-time data visualization
│   └── TrackVisualizer.tsx # GPS track rendering
├── pages/
│   ├── Dashboard.tsx       # Main dashboard view
│   ├── LiveSession.tsx     # Live telemetry session
│   └── Analysis.tsx        # Post-session lap analysis
├── services/
│   ├── coachingService.ts  # AI coaching logic (Nano + Cloud)
│   ├── geminiService.ts    # Gemini API integration
│   └── gpsService.ts       # GPS data processing
├── types.ts                # TypeScript type definitions
├── constants.ts            # Track data and configuration
└── App.tsx                 # Main application component
```

## Usage

1. **Dashboard** - View session overview and navigate to live or analysis modes
2. **Live Session** - Start a session to receive real-time AI coaching based on telemetry
3. **Analysis** - Review completed laps with detailed telemetry charts and coaching insights

## License

MIT

---

<div align="center">
Built with Gemini AI
</div>
