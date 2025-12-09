import React, { useState, useEffect } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';
import { Track } from '../types';

interface GoogleMapsTrackProps {
    track: Track;
    carPosition: { lat: number; lng: number } | null;
    className?: string;
    apiKey?: string;
}

export const GoogleMapsTrack: React.FC<GoogleMapsTrackProps> = ({ track, carPosition, className, apiKey }) => {
    const [mapId] = useState('bf51a910020fa25a'); // A standard dark map ID or similar for styling if available, using a generic one or allowing standard ID

    const defaultCenter = track.center || { lat: 0, lng: 0 };
    const [center, setCenter] = useState(defaultCenter);

    // Auto-follow car
    useEffect(() => {
        if (carPosition) {
            setCenter(carPosition);
        }
    }, [carPosition]);

    // If no API key is provided, we can't render the map.
    if (!apiKey) {
        return (
            <div className={`flex items-center justify-center bg-slate-900 border border-slate-800 rounded-xl ${className}`}>
                <div className="text-center p-6 text-slate-400">
                    <p className="mb-2 font-bold text-amber-500">Google Maps API Key Required</p>
                    <p className="text-sm">Please configure your API key to view the satellite track.</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`relative overflow-hidden rounded-xl border border-white/10 ${className}`}>
            <APIProvider apiKey={apiKey}>
                <Map
                    defaultCenter={defaultCenter}
                    center={center}
                    onCenterChanged={(ev) => setCenter(ev.detail.center)}
                    defaultZoom={track.zoom || 15}
                    minZoom={14}
                    maxZoom={20}
                    restriction={track.center ? {
                        latLngBounds: {
                            north: track.center.lat + 0.015,
                            south: track.center.lat - 0.015,
                            east: track.center.lng + 0.02,
                            west: track.center.lng - 0.02,
                        },
                        strictBounds: true
                    } : undefined}
                    mapId={mapId}
                    opts={{
                        mapTypeId: 'satellite',
                        disableDefaultUI: true,
                        rotateControl: true,
                        tilt: 0, // Top-down for accurate track view (requested "Map only renders track")
                        heading: 0,
                        gestureHandling: 'cooperative' // Prevent easy scroll away
                    }}
                    className="w-full h-full"
                >
                    {/* Car Marker */}
                    {carPosition && (
                        <AdvancedMarker position={carPosition} title="Your Car">
                            <div className="relative flex items-center justify-center">
                                <div className="w-4 h-4 bg-sky-500 border-2 border-white rounded-full shadow-[0_0_10px_#38bdf8] z-20"></div>
                                <div className="absolute w-12 h-12 bg-sky-500/30 rounded-full animate-ping z-10"></div>
                            </div>
                        </AdvancedMarker>
                    )}

                    {/* Optional: Add Start/Finish line marker if we have points */}
                    {track.center && (
                        <AdvancedMarker position={track.center} title="Track Center">
                            <div className="opacity-0 w-1 h-1"></div>
                        </AdvancedMarker>
                    )}
                </Map>
            </APIProvider>

            {/* Overlay HUD for Map */}
            <div className="absolute bottom-4 left-4 pointer-events-none z-10">
                <div className="flex items-center gap-2 bg-black/50 backdrop-blur px-3 py-1.5 rounded-full border border-white/10">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-[10px] font-mono font-bold text-emerald-400">SATELLITE LIVE</span>
                </div>
            </div>
        </div>
    );
};
