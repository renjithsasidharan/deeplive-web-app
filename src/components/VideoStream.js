import React, { useEffect, useRef, useState } from 'react';
import { Select, MenuItem, Button, Typography, Box, Paper } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';

const VideoStream = () => {
    const videoRef = useRef(null);
    const wsRef = useRef(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [videoDevices, setVideoDevices] = useState([]);
    const [selectedDevice, setSelectedDevice] = useState('');

    useEffect(() => {
        // Fetch available video devices
        const getVideoDevices = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoInputs = devices.filter(device => device.kind === 'videoinput');
                setVideoDevices(videoInputs);
                if (videoInputs.length > 0) {
                    setSelectedDevice(videoInputs[0].deviceId);
                }
            } catch (error) {
                console.error('Error enumerating devices:', error);
            }
        };

        getVideoDevices();
    }, []);

    useEffect(() => {
        const connectWebSocket = () => {
            wsRef.current = new WebSocket('ws://localhost:8000/ws/video');

            wsRef.current.onopen = () => {
                console.log('WebSocket connected');
                setIsStreaming(true);
            };

            wsRef.current.onerror = (error) => {
                console.error('WebSocket error:', error);
                wsRef.current.close();
            };
        };

        const startVideoStream = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: selectedDevice ? { exact: selectedDevice } : undefined }
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.onloadedmetadata = () => {
                        setIsPlaying(true);
                        connectWebSocket();
                    };
                }
            } catch (error) {
                console.error('Error accessing video stream:', error);
            }
        };

        if (isPlaying && selectedDevice) {
            startVideoStream();
        } else {
            if (videoRef.current && videoRef.current.srcObject) {
                videoRef.current.srcObject.getTracks().forEach(track => track.stop());
            }
            if (wsRef.current) {
                wsRef.current.close();
            }
        }

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (videoRef.current && videoRef.current.srcObject) {
                videoRef.current.srcObject.getTracks().forEach(track => track.stop());
            }
        };
    }, [isPlaying, selectedDevice]);

    const togglePlayPause = () => {
        setIsPlaying(!isPlaying);
    };

    const handleDeviceChange = (event) => {
        setSelectedDevice(event.target.value);
        if (isPlaying) {
            setIsPlaying(false);
            setTimeout(() => setIsPlaying(true), 100);
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <Paper
                elevation={3}
                sx={{
                    width: 320,
                    height: 240,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    overflow: 'hidden',
                    bgcolor: 'grey.200',
                }}
            >
                {isPlaying ? (
                    <video
                        ref={videoRef}
                        autoPlay
                        muted
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                ) : (
                    <Typography variant="body1" color="text.secondary">
                        Camera Off
                    </Typography>
                )}
            </Paper>
            <Select
                value={selectedDevice}
                onChange={handleDeviceChange}
                displayEmpty
                sx={{ width: 320 }}
            >
                <MenuItem value="" disabled>
                    Select a camera
                </MenuItem>
                {videoDevices.map((device) => (
                    <MenuItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera ${videoDevices.indexOf(device) + 1}`}
                    </MenuItem>
                ))}
            </Select>
            <Button
                variant="contained"
                color={isPlaying ? "error" : "primary"}
                startIcon={isPlaying ? <VideocamOffIcon /> : <VideocamIcon />}
                onClick={togglePlayPause}
            >
                {isPlaying ? "Stop Camera" : "Start Camera"}
            </Button>
            <Typography variant="body2" color="text.secondary">
                {isStreaming ? 'Streaming...' : 'Not streaming'}
            </Typography>
        </Box>
    );
};

export default VideoStream;