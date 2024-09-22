import React, { useEffect, useRef, useState } from 'react';
import { Select, MenuItem, Button, Typography, Box, Paper, Checkbox, FormGroup, FormControlLabel, Avatar, IconButton } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { BACKEND_URL, WS_URL } from '../config';

const DEFAULT_IMAGES = [
    { id: 'default1', name: 'Default 1', path: './default_images/1.jpg' },
    { id: 'default2', name: 'Default 2', path: './default_images/2.jpg' },
];

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
    const [maintainFps, setMaintainFps] = useState(false);
    const [fps, setFps] = useState(0);

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
        // Load default images
        const loadDefaultImages = async () => {
            const defaultImagePromises = DEFAULT_IMAGES.map(async (img) => {
                const response = await fetch(img.path);
                const blob = await response.blob();
                const base64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
                return { ...img, image: base64.split(',')[1] };
            });

            const loadedDefaultImages = await Promise.all(defaultImagePromises);
            setSourceImages(loadedDefaultImages);
            setCurrentSourceImage(loadedDefaultImages[0].id);

            // Set the first default image as the current source image on the backend
            await handleImageSelect(loadedDefaultImages[0].id);
        };

        loadDefaultImages();
    }, []);

    useEffect(() => {
        let animationFrameId;

        const connectWebSocket = () => {
            wsRef.current = new WebSocket(WS_URL);

            wsRef.current.onopen = () => {
                console.log('WebSocket connected');
                setIsStreaming(true);
                sendFrame();
            };

            wsRef.current.onmessage = (event) => {
                if (event.data instanceof Blob) {
                    // Handle binary data (processed video frame)
                    const url = URL.createObjectURL(event.data);
                    const img = new Image();
                    img.onload = () => {
                        const ctx = processedCanvasRef.current.getContext('2d');
                        ctx.drawImage(img, 0, 0, processedCanvasRef.current.width, processedCanvasRef.current.height);
                        URL.revokeObjectURL(url);
                    };
                    img.src = url;
                } else {
                    // Handle text data (FPS information)
                    try {
                        const data = JSON.parse(event.data);
                        if (data.fps) {
                            setFps(data.fps);
                        }
                    } catch (error) {
                        console.error('Error processing WebSocket message:', error);
                    }
                }
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

    const togglePlayPause = async () => {
        if (!isPlaying) {
            // If starting the camera, set the selected source image
            if (currentSourceImage) {
                await setSourceImageOnBackend(currentSourceImage);
            }
        }
        setIsPlaying(!isPlaying);
    };

    const setSourceImageOnBackend = async (imageId) => {
        const selectedImage = sourceImages.find(img => img.id === imageId);
        if (selectedImage) {
            const formData = new FormData();
            const blob = await fetch(`data:image/jpeg;base64,${selectedImage.image}`).then(res => res.blob());
            formData.append('file', blob, 'image.jpg');

            try {
                const response = await fetch(`${BACKEND_URL}/set_source_image`, {
                    method: 'POST',
                    body: formData,
                });

                if (!response.ok) {
                    throw new Error('Failed to set source image on backend');
                }
            } catch (error) {
                console.error('Error setting source image:', error);
                // Optionally, you can show an error message to the user here
            }
        }
    };

    const handleImageSelect = async (imageId) => {
        setCurrentSourceImage(imageId);
        if (isPlaying) {
            await setSourceImageOnBackend(imageId);
        }
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

            updateBackendConfig(selectedProcessors, maintainFps);

            return updated;
        });
    };

    const handleMaintainFpsChange = (event) => {
        const newMaintainFps = event.target.checked;
        setMaintainFps(newMaintainFps);
        const selectedProcessors = Object.entries(frameProcessors)
            .filter(([_, value]) => value)
            .map(([key, _]) => key);
        updateBackendConfig(selectedProcessors, newMaintainFps);
    };

    const updateBackendConfig = async (selectedProcessors, maintainFps) => {
        try {
            const response = await fetch(`${BACKEND_URL}/set_config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    frame_processors: selectedProcessors,
                    maintain_fps: maintainFps
                }),
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
            const response = await fetch(`${BACKEND_URL}/set_source_image`, {
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
                        {!DEFAULT_IMAGES.some(defaultImg => defaultImg.id === image.id) && (
                            <IconButton
                                size="small"
                                sx={{ position: 'absolute', top: -8, right: -8 }}
                                onClick={() => handleImageDelete(image.id)}
                            >
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        )}
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
                <FormControlLabel
                    control={<Checkbox checked={maintainFps} onChange={handleMaintainFpsChange} />}
                    label="Maintain FPS"
                />
            </FormGroup>
            <Typography variant="body2" color="text.secondary">
                {isStreaming ? `Streaming... FPS: ${fps}` : 'Not streaming'}
            </Typography>
        </Box>
    );
};

export default VideoStream;