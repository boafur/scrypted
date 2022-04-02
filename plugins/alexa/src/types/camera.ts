import sdk, { FFMpegInput, HttpResponse, MotionSensor, RTCAVSignalingSetup, RTCSignalingChannel, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, VideoCamera } from "@scrypted/sdk";
import { addSupportedType, AlexaCapabilityHandler, capabilityHandlers, EventReport } from "./common";
import { startRTCPeerConnectionFFmpegInput } from '@scrypted/common/src/ffmpeg-to-wrtc';
import { BrowserSignalingSession, startRTCSignalingSession } from '@scrypted/common/src/rtc-signaling';
import crypto from 'crypto';
import { createMessageId } from "../message";
import { Capability } from "alexa-smarthome-ts/lib/skill/Capability";
import { DiscoveryEndpoint } from "alexa-smarthome-ts";

const { mediaManager } = sdk;

addSupportedType(ScryptedDeviceType.Camera, {
    probe(device) {
        if (!device.interfaces.includes(ScryptedInterface.VideoCamera))
            return;


        const capabilities: Capability<any>[] = [
            {
                "type": "AlexaInterface",
                "interface": "Alexa.RTCSessionController",
                "version": "3",
                "configuration": {
                    "isFullDuplexAudioSupported": false,
                }
            } as any,
        ];

        if (device.interfaces.includes(ScryptedInterface.MotionSensor)) {
            capabilities.push(
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.MotionSensor",
                    "version": "3",
                    "properties": {
                        "supported": [
                            {
                                "name": "detectionState"
                            }
                        ],
                        "proactivelyReported": true,
                        "retrievable": true
                    }
                },
            )
        }

        return {
            displayCategories: ['CAMERA'],
            capabilities,
        }
    },
    async reportState(eventSource: ScryptedDevice & MotionSensor, eventDetails, eventData): Promise<EventReport> {
        if (eventDetails.eventInterface !== ScryptedInterface.MotionSensor)
            return undefined;
        return {
            type: 'event',
            namespace: 'Alexa',
            name: 'ChangeReport',
            payload: {
                change: {
                    cause: {
                        type: "PHYSICAL_INTERACTION"
                    },
                    properties: [
                        {
                            "namespace": "Alexa.MotionSensor",
                            "name": "detectionState",
                            "value": eventData ? "DETECTED" : "NOT_DETECTED",
                            "timeOfSample": new Date().toISOString(),
                            "uncertaintyInMilliseconds": 0
                        }
                    ]
                }
            },
        };
    }
});

export const rtcHandlers = new Map<string, AlexaCapabilityHandler<any>>();

export class AlexaSignalingSession implements RTCSignalingSession {
    constructor(public response: HttpResponse, public directive: any) {
    }

    async getOptions(): Promise<RTCSignalingOptions> {
        return {
            proxy: true,
            offer: {
                type: 'offer',
                sdp: this.directive.payload.offer.value,
            }
        }
    }

    async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
        return {
            type: 'offer',
            sdp: this.directive.payload.offer.value,
        }
    }

    async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        throw new Error("trickle ICE is not supported by Alexa");
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup): Promise<void> {
        this.response.send(JSON.stringify({
            "event": {
                "header": {
                    "namespace": "Alexa.RTCSessionController",
                    "name": "AnswerGeneratedForSession",
                    "messageId": createMessageId(),
                    "payloadVersion": "3"
                },
                "payload": {
                    "answer": {
                        "format": "SDP",
                        "value": description.sdp,
                    }
                }
            }
        }));
    }
}

rtcHandlers.set('InitiateSessionWithOffer', async (request, response, directive: any,
    device: ScryptedDevice & RTCSignalingChannel) => {
    const session = new AlexaSignalingSession(response, directive);
    device.startRTCSignalingSession(session);
});

capabilityHandlers.set('Alexa.RTCSessionController', async (request, response, directive: any, device: ScryptedDevice & VideoCamera) => {
    const { name } = directive.header;
    const handler = rtcHandlers.get(name);
    if (handler)
        return handler.apply(this, [request, response, directive, device]);

    const { sessionId } = directive.payload;
    const body = {
        "event": {
            "header": {
                "namespace": "Alexa.RTCSessionController",
                name,
                "messageId": createMessageId(),
                "payloadVersion": "3"
            },
            "payload": {
                sessionId,
            }
        }
    };

    response.send(JSON.stringify(body));
});
