import React, { useState, useRef } from 'react';
import { Upload, Video, Play, FileVideo, Brain, AlertCircle, Youtube } from 'lucide-react';
import { analyzeVideo } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';

export const VideoAnalysis: React.FC = () => {
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [youtubeUrl, setYoutubeUrl] = useState('');
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setVideoFile(file);
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
            setAnalysis(null);
        }
    };

    const handleUrlAnalyze = async () => {
        if (!youtubeUrl) return;

        setIsAnalyzing(true);
        setAnalysis(null);
        setPreviewUrl(null);
        setVideoFile(null); // Clear previous file

        try {
            // Fetch from local proxy
            const response = await fetch(`http://localhost:3001/api/download-youtube?url=${encodeURIComponent(youtubeUrl)}`);
            if (!response.ok) throw new Error('Failed to download');

            const blob = await response.blob();
            const file = new File([blob], "youtube_video.mp4", { type: "video/mp4" });

            setVideoFile(file);
            setPreviewUrl(URL.createObjectURL(file));

            // Now analyze
            const result = await analyzeVideo(file);
            setAnalysis(result);

        } catch (e) {
            console.error(e);
            setAnalysis("Error downloading or analyzing YouTube video. Ensure the local server is running (node server/index.js).");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleAnalyze = async () => {
        if (!videoFile) return;

        setIsAnalyzing(true);
        setAnalysis(null);

        const result = await analyzeVideo(videoFile);

        setAnalysis(result);
        setIsAnalyzing(false);
    };

    return (
        <div className="flex flex-col h-full bg-[#0B0F19] text-white p-6 md:p-8 overflow-y-auto">
            <div className="max-w-4xl mx-auto w-full space-y-8">

                {/* Header */}
                <div>
                    <h1 className="text-2xl font-bold mb-2 flex items-center gap-3">
                        <Video className="text-indigo-500" />
                        Video Coach
                    </h1>
                    <p className="text-slate-400">Upload race footage or paste a YouTube link for AI analysis.</p>
                </div>

                {/* Input Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">

                        {/* YouTube Input */}
                        <div className="bg-slate-900/50 border border-white/5 p-4 rounded-xl space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                <Youtube size={14} className="text-red-500" />
                                YouTube Analysis
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Paste YouTube URL..."
                                    value={youtubeUrl}
                                    onChange={(e) => setYoutubeUrl(e.target.value)}
                                    className="flex-1 bg-slate-800 border-none rounded px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:ring-1 focus:ring-red-500 outline-none"
                                />
                                <button
                                    onClick={handleUrlAnalyze}
                                    disabled={!youtubeUrl || isAnalyzing}
                                    className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Fetch
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 text-xs font-bold text-slate-600 uppercase tracking-widest">
                            <div className="h-px bg-slate-800 flex-1" />
                            OR
                            <div className="h-px bg-slate-800 flex-1" />
                        </div>

                        {/* File Upload */}
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all h-[250px] ${videoFile
                                ? 'border-indigo-500/50 bg-indigo-500/5'
                                : 'border-slate-700 hover:border-indigo-500 hover:bg-slate-800'
                                }`}
                        >
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                accept="video/*"
                                className="hidden"
                            />

                            {previewUrl ? (
                                <div className="relative w-full h-full">
                                    <video
                                        src={previewUrl}
                                        controls
                                        className="w-full h-full object-contain rounded"
                                    />
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setVideoFile(null); setPreviewUrl(null); }}
                                        className="absolute top-2 right-2 bg-black/50 hover:bg-black/80 text-white p-1 rounded-full"
                                    >
                                        <AlertCircle size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div className="text-center space-y-4">
                                    <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto">
                                        <Upload className="text-slate-400" size={32} />
                                    </div>
                                    <div>
                                        <p className="font-bold text-lg">Upload Video File</p>
                                        <p className="text-sm text-slate-500">MP4, WebM, MOV</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {videoFile && !youtubeUrl && (
                            <button
                                onClick={handleAnalyze}
                                disabled={!videoFile || isAnalyzing}
                                className={`w-full py-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${isAnalyzing
                                    ? 'bg-indigo-900 text-indigo-200 cursor-wait'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25'
                                    }`}
                            >
                                {isAnalyzing ? (
                                    <>
                                        <Brain className="animate-pulse" /> Analyzing Footage...
                                    </>
                                ) : (
                                    <>
                                        <Play size={20} fill="currentColor" /> Analyze Driving
                                    </>
                                )}
                            </button>
                        )}
                    </div>

                    {/* Analysis Result */}
                    <div className="bg-slate-900/50 border border-white/5 rounded-xl p-6 min-h-[300px] flex flex-col">
                        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                            <Brain size={16} />
                            Coach's Feedback
                        </h2>

                        {analysis ? (
                            <div className="prose prose-invert prose-sm max-w-none font-sans text-slate-300 leading-relaxed">
                                <ReactMarkdown>
                                    {analysis}
                                </ReactMarkdown>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-600 text-center p-8">
                                {isAnalyzing ? (
                                    <div className="space-y-4 w-full max-w-xs animate-pulse">
                                        <div className="h-2 bg-slate-800 rounded w-3/4 mx-auto"></div>
                                        <div className="h-2 bg-slate-800 rounded w-1/2 mx-auto"></div>
                                        <div className="h-2 bg-slate-800 rounded w-5/6 mx-auto"></div>
                                    </div>
                                ) : (
                                    <>
                                        <FileVideo size={48} className="mb-4 opacity-50" />
                                        <p>Upload a video or use a YouTube link for detailed analysis.</p>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
