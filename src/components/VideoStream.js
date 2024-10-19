import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Select, MenuItem, Button, Typography, Box, Paper, Checkbox, FormControlLabel, Avatar, IconButton } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CropIcon from '@mui/icons-material/Crop';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { BACKEND_URL, WS_URL } from '../config';

const DEFAULT_IMAGES = [
    { id: 'default1', name: 'Default 1', path: './default_images/1.jpg' },
    { id: 'default2', name: 'Default 2', path: './default_images/2.jpg' },
];

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 3000; // 3 seconds

const VideoStream = () => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const processedCanvasRef = useRef(null);
    const wsRef = useRef(null);
    const lastFrameTimeRef = useRef(0);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
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
    const [isCropping, setIsCropping] = useState(false);
    const [crop, setCrop] = useState();
    const [completedCrop, setCompletedCrop] = useState(null);
    const cropCanvasRef = useRef(null);
    const [wsConnected, setWsConnected] = useState(false);
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimeoutRef = useRef(null);
    const animationFrameIdRef = useRef(null);

    const FRAME_INTERVAL = 25 ;
    const FRAME_WIDTH = 480;  // Reduced frame width
    const FRAME_HEIGHT = 320; // Reduced frame height

    const streamRef = useRef(null);

    const setSourceImageOnBackend = useCallback(async (imageId) => {
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
    }, [sourceImages]); // Add sourceImages as a dependency

    const handleImageSelect = useCallback(async (imageId) => {
        setCurrentSourceImage(imageId);
        if (isPlaying || isScreenSharing) {
            await setSourceImageOnBackend(imageId);
        }
    }, [isPlaying, isScreenSharing, setSourceImageOnBackend]); // Add setSourceImageOnBackend to the dependency array

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
        };

        loadDefaultImages();
    }, []); // Empty dependency array as this should only run once on mount

    useEffect(() => {
        if (currentSourceImage) {
            setSourceImageOnBackend(currentSourceImage);
        }
    }, [currentSourceImage, setSourceImageOnBackend]);

    const connectWebSocket = useCallback(() => {
        const attemptConnect = () => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                return; // Already connected
            }

            wsRef.current = new WebSocket(WS_URL);

            wsRef.current.onopen = () => {
                console.log('WebSocket connected');
                setWsConnected(true);
                setIsStreaming(true);
                reconnectAttemptsRef.current = 0;
            };

            wsRef.current.onclose = (event) => {
                console.log('WebSocket disconnected', event);
                setWsConnected(false);
                setIsStreaming(false);
                attemptReconnect();
            };

            wsRef.current.onerror = (error) => {
                console.error('WebSocket error:', error);
                setWsConnected(false);
                setIsStreaming(false);
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
        };

        const attemptReconnect = () => {
            if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttemptsRef.current += 1;
                console.log(`Attempting to reconnect (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);
                reconnectTimeoutRef.current = setTimeout(attemptConnect, RECONNECT_INTERVAL);
            } else {
                console.error('Max reconnection attempts reached. Please try again later.');
            }
        };

        attemptConnect();
    }, []);  // Empty dependency array as all used variables are from refs or component scope

    useEffect(() => {
        if (isPlaying || isScreenSharing) {
            connectWebSocket();
        } else {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        }

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, [isPlaying, isScreenSharing, connectWebSocket]);

    const toggleCropping = useCallback(() => {
        setIsCropping((prev) => !prev);
        if (isCropping) {
            setCompletedCrop(null);
            setCrop(undefined);
        }
    }, [isCropping]);

    useEffect(() => {
        if (!completedCrop || !cropCanvasRef.current || !videoRef.current) {
            return;
        }

        const video = videoRef.current;
        const canvas = cropCanvasRef.current;
        const ctx = canvas.getContext('2d');

        const scaleX = video.videoWidth / video.offsetWidth;
        const scaleY = video.videoHeight / video.offsetHeight;

        canvas.width = completedCrop.width;
        canvas.height = completedCrop.height;

        if (canvas.width > 0 && canvas.height > 0) {
            ctx.drawImage(
                video,
                completedCrop.x * scaleX,
                completedCrop.y * scaleY,
                completedCrop.width * scaleX,
                completedCrop.height * scaleY,
                0,
                0,
                completedCrop.width,
                completedCrop.height
            );
        }
    }, [completedCrop]);

    const sendFrame = useCallback((timestamp) => {
        if (timestamp - lastFrameTimeRef.current >= FRAME_INTERVAL) {
            if (videoRef.current && canvasRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                const context = canvasRef.current.getContext('2d');
                context.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
                
                if (completedCrop && cropCanvasRef.current && cropCanvasRef.current.width > 0 && cropCanvasRef.current.height > 0) {
                    context.drawImage(cropCanvasRef.current, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
                } else {
                    context.drawImage(videoRef.current, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
                }

                canvasRef.current.toBlob(
                    (blob) => {
                        if (blob && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                            wsRef.current.send(blob);
                        } else if (!wsConnected) {
                            console.warn('WebSocket not connected. Unable to send frame.');
                        }
                    },
                    'image/jpeg',
                    0.8
                );
            }
            lastFrameTimeRef.current = timestamp;
        }
        animationFrameIdRef.current = requestAnimationFrame(sendFrame);
    }, [wsConnected, completedCrop, FRAME_HEIGHT, FRAME_WIDTH]);

    useEffect(() => {
        if (videoRef.current && streamRef.current) {
            videoRef.current.srcObject = streamRef.current;
        }
    }, [isPlaying]);

    useEffect(() => {
        if (wsConnected) {
            animationFrameIdRef.current = requestAnimationFrame(sendFrame);
        }

        return () => {
            if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current);
            }
        };
    }, [wsConnected, sendFrame]);

    const togglePlayPause = async () => {
        if (isScreenSharing) {
            stopScreenShare();
        } else if (!isPlaying) {
            try {
                // Set the source image before starting the camera
                if (currentSourceImage) {
                    await setSourceImageOnBackend(currentSourceImage);
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: selectedDevice ? { exact: selectedDevice } : undefined }
                });
                streamRef.current = stream;
                setIsPlaying(true);
            } catch (error) {
                console.error('Error accessing video stream:', error);
            }
        } else {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
            setIsPlaying(false);
        }
    };

    const toggleScreenShare = async () => {
        if (isScreenSharing) {
            stopScreenShare();
        } else {
            try {
                // Set the source image before starting screen sharing
                if (currentSourceImage) {
                    await setSourceImageOnBackend(currentSourceImage);
                }

                const stream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        displaySurface: "window",
                    },
                    audio: false
                });
                
                const videoTrack = stream.getVideoTracks()[0];
                if (videoTrack.getSettings().displaySurface !== 'window') {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }

                streamRef.current = stream;
                setIsScreenSharing(true);
                setIsPlaying(true);

                videoTrack.onended = () => {
                    stopScreenShare();
                };
            } catch (error) {
                console.error('Error accessing screen share:', error);
            }
        }
    };

    const stopScreenShare = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setIsScreenSharing(false);
        setIsPlaying(false);
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
            <Box sx={{ display: 'flex', gap: 2, position: 'relative' }}>
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
                        position: 'relative',
                    }}
                >
                    {isPlaying && (
                        <ReactCrop
                            crop={crop}
                            onChange={(_, percentCrop) => setCrop(percentCrop)}
                            onComplete={(c) => setCompletedCrop(c)}
                            disabled={!isCropping}
                            // Remove the aspect prop to allow free-form cropping
                        >
                            <video
                                ref={videoRef}
                                autoPlay
                                muted
                                playsInline
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                        </ReactCrop>
                    )}
                    {!isPlaying && (
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
            <canvas ref={cropCanvasRef} style={{ display: 'none' }} />
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
            <Box sx={{ display: 'flex', gap: 2 }}>
                <Button
                    variant="contained"
                    color={isPlaying && !isScreenSharing ? "error" : "primary"}
                    startIcon={isPlaying && !isScreenSharing ? <VideocamOffIcon /> : <VideocamIcon />}
                    onClick={togglePlayPause}
                    disabled={isScreenSharing}
                >
                    {isPlaying && !isScreenSharing ? "Stop Camera" : "Start Camera"}
                </Button>
                <Button
                    variant="contained"
                    color={isScreenSharing ? "error" : "primary"}
                    startIcon={isScreenSharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
                    onClick={toggleScreenShare}
                    disabled={isPlaying && !isScreenSharing}
                >
                    {isScreenSharing ? "Stop Window Share" : "Share Window"}
                </Button>
                <Button
                    variant="contained"
                    color={isCropping ? "secondary" : "primary"}
                    startIcon={<CropIcon />}
                    onClick={toggleCropping}
                    disabled={!isPlaying && !isScreenSharing}
                >
                    {isCropping ? "Finish Cropping" : "Crop Video"}
                </Button>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'row', gap: 2, alignItems: 'center' }}>
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
            </Box>
            <Typography variant="body2" color="text.secondary">
                {isStreaming ? `Streaming... FPS: ${fps}` : 'Not streaming'}
                {!wsConnected && ' (WebSocket disconnected)'}
            </Typography>
        </Box>
    );
};

export default VideoStream;
