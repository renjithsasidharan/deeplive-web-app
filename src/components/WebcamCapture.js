import React, { useRef, useCallback } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';

const WebcamCapture = () => {
    const webcamRef = useRef(null);

    const capture = useCallback(() => {
        const imageSrc = webcamRef.current?.getScreenshot();
        if (imageSrc) {
            // Convert base64 to blob
            fetch(imageSrc)
                .then(res => res.blob())
                .then(blob => {
                    const formData = new FormData();
                    formData.append('file', blob, 'webcam.jpg');

                    // Send to backend
                    axios.post('http://localhost:8000/upload', formData, {
                        headers: {
                            'Content-Type': 'multipart/form-data',
                        },
                    })
                    .then(response => {
                        console.log('File uploaded successfully', response.data);
                    })
                    .catch(error => {
                        console.error('Error uploading file', error);
                    });
                });
        }
    }, [webcamRef]);

    return (
        <div>
            <Webcam
                audio={false}
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                width={320}  // Set the desired width
                height={240} // Set the desired height
            />
            <button onClick={capture}>Capture photo</button>
        </div>
    );
};

export default WebcamCapture;