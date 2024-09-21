import React, { useEffect, useRef, useState } from 'react';
import { Select, MenuItem, Button, Typography, Box, Paper, Checkbox, FormGroup, FormControlLabel, Avatar, IconButton } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

const VideoStream = () => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const processedCanvasRef = useRef(null);
    const wsRef = useRef(null);
    const lastFrameTimeRef = useRef(0);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [videoDevices, setVideoDevices] = useState([]);
    const [selectedDevice, setSelectedDevice] = useState('');
    const [frameProcessors, setFrameProcessors] = useState({
        face_swapper: true,
        face_enhancer: false
    });
    const [sourceImages, setSourceImages] = useState([]);
    const [currentSourceImage, setCurrentSourceImage] = useState(null);

    const FRAME_INTERVAL = 50; // 50ms between frames, i.e., 20 FPS
    const FRAME_WIDTH = 320*2;  // Reduced frame width
    const FRAME_HEIGHT = 240*2; // Reduced frame height

    useEffect(() => {
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
        let animationFrameId;

        const connectWebSocket = () => {
            wsRef.current = new WebSocket('ws://136.38.166.236:33242/ws/video');

            wsRef.current.onopen = () => {
                console.log('WebSocket connected');
                setIsStreaming(true);
                sendFrame();
            };

            wsRef.current.onmessage = (event) => {
                const blob = event.data;
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    const ctx = processedCanvasRef.current.getContext('2d');
                    ctx.drawImage(img, 0, 0, processedCanvasRef.current.width, processedCanvasRef.current.height);
                    URL.revokeObjectURL(url);
                };
                img.src = url;
            };

            wsRef.current.onerror = (error) => {
                console.error('WebSocket error:', error);
                wsRef.current.close();
            };

            wsRef.current.onclose = () => {
                console.log('WebSocket closed');
                setIsStreaming(false);
            };
        };

        const sendFrame = (timestamp) => {
            if (timestamp - lastFrameTimeRef.current >= FRAME_INTERVAL) {
                if (videoRef.current && canvasRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    const context = canvasRef.current.getContext('2d');
                    context.drawImage(videoRef.current, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
                    canvasRef.current.toBlob(
                        (blob) => {
                            if (blob) {
                                wsRef.current.send(blob);
                            }
                        },
                        'image/jpeg',
                        0.8
                    );
                }
                lastFrameTimeRef.current = timestamp;
            }
            animationFrameId = requestAnimationFrame(sendFrame);
        };

        const startVideoStream = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: selectedDevice ? { exact: selectedDevice } : undefined }
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.onloadedmetadata = () => {
                        videoRef.current.play();
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
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        }

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (videoRef.current && videoRef.current.srcObject) {
                videoRef.current.srcObject.getTracks().forEach(track => track.stop());
            }
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
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

    const handleFrameProcessorChange = async (event) => {
        const { name, checked } = event.target;
        
        setFrameProcessors(prev => {
            const updated = { ...prev, [name]: checked };
            
            const selectedProcessors = Object.entries(updated)
                .filter(([_, value]) => value)
                .map(([key, _]) => key);

            updateBackendConfig(selectedProcessors);

            return updated;
        });
    };

    const updateBackendConfig = async (selectedProcessors) => {
        try {
            const response = await fetch('http://136.38.166.236:33242/set_config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ frame_processors: selectedProcessors }),
            });

            if (!response.ok) {
                throw new Error('Failed to update configuration');
            }

            console.log('Configuration updated successfully');
        } catch (error) {
            console.error('Error updating configuration:', error);
        }
    };

    const handleImageUpload = async (event) => {
        const file = event.target.files[0];
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('http://136.38.166.236:33242/set_source_image', {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                const result = await response.json();
                const newImage = {
                    id: Date.now().toString(),
                    image: result.image
                };
                setSourceImages(prev => [...prev, newImage]);
                setCurrentSourceImage(newImage.id);
            }
        } catch (error) {
            console.error('Error uploading image:', error);
        }
    };

    const handleImageSelect = async (imageId) => {
        const selectedImage = sourceImages.find(img => img.id === imageId);
        if (selectedImage) {
            const formData = new FormData();
            const blob = await fetch(`data:image/jpeg;base64,${selectedImage.image}`).then(res => res.blob());
            formData.append('file', blob, 'image.jpg');

            try {
                const response = await fetch('http://136.38.166.236:33242/set_source_image', {
                    method: 'POST',
                    body: formData,
                });

                if (response.ok) {
                    setCurrentSourceImage(imageId);
                }
            } catch (error) {
                console.error('Error setting source image:', error);
            }
        }
    };

    const handleImageDelete = (imageId) => {
        setSourceImages(prev => prev.filter(img => img.id !== imageId));
        if (currentSourceImage === imageId) {
            setCurrentSourceImage(null);
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'row', gap: 2, alignItems: 'center', marginBottom: 2 }}>
                {sourceImages.map((image) => (
                    <Box key={image.id} sx={{ position: 'relative' }}>
                        <Avatar
                            src={`data:image/jpeg;base64,${image.image}`}
                            sx={{ 
                                width: 60, 
                                height: 60, 
                                cursor: 'pointer',
                                border: currentSourceImage === image.id ? '2px solid blue' : 'none'
                            }}
                            onClick={() => handleImageSelect(image.id)}
                        />
                        <IconButton
                            size="small"
                            sx={{ position: 'absolute', top: -8, right: -8 }}
                            onClick={() => handleImageDelete(image.id)}
                        >
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Box>
                ))}
                <IconButton component="label">
                    <AddIcon />
                    <input type="file" hidden onChange={handleImageUpload} accept="image/*" />
                </IconButton>
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
                <Paper
                    elevation={3}
                    sx={{
                        width: FRAME_WIDTH,
                        height: FRAME_HEIGHT,
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
                <Paper
                    elevation={3}
                    sx={{
                        width: FRAME_WIDTH,
                        height: FRAME_HEIGHT,
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        overflow: 'hidden',
                        bgcolor: 'grey.200',
                    }}
                >
                    <canvas
                        ref={processedCanvasRef}
                        width={FRAME_WIDTH}
                        height={FRAME_HEIGHT}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                </Paper>
            </Box>
            <canvas ref={canvasRef} style={{ display: 'none' }} width={FRAME_WIDTH} height={FRAME_HEIGHT} />
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
            <FormGroup>
                <FormControlLabel
                    control={<Checkbox checked={frameProcessors.face_swapper} onChange={handleFrameProcessorChange} name="face_swapper" />}
                    label="Face Swapper"
                />
                <FormControlLabel
                    control={<Checkbox checked={frameProcessors.face_enhancer} onChange={handleFrameProcessorChange} name="face_enhancer" />}
                    label="Face Enhancer"
                />
            </FormGroup>
            <Typography variant="body2" color="text.secondary">
                {isStreaming ? 'Streaming...' : 'Not streaming'}
            </Typography>
        </Box>
    );
};

export default VideoStream;