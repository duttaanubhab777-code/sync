import { Notification } from "../models/notification.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
    getVapidPublicKey,
    isFcmConfigured,
    savePushSubscription,
    removePushSubscription
} from "../services/push.service.js";

export const getNotifications = asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const notifications = await Notification.find({ recipient: req.user._id })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("actor", "username fullName avatar")
        .lean();
    const unreadCount = await Notification.countDocuments({
        recipient: req.user._id,
        readAt: null
    });
    res.status(200).json(new ApiResponse(200, { notifications, unreadCount }));
});

export const markNotificationRead = asyncHandler(async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
        { _id: req.params.id, recipient: req.user._id, readAt: null },
        { $set: { readAt: new Date() } },
        { new: true }
    );
    res.status(200).json(new ApiResponse(200, { notification }));
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
    await Notification.updateMany(
        { recipient: req.user._id, readAt: null },
        { $set: { readAt: new Date() } }
    );
    res.status(200).json(new ApiResponse(200, { updated: true }));
});

export const getPushConfig = asyncHandler(async (_req, res) => {
    const publicKey = getVapidPublicKey();
    const fcmEnabled = isFcmConfigured();
    res.status(200).json(
        new ApiResponse(200, {
            enabled: Boolean(publicKey) || fcmEnabled,
            webPushEnabled: Boolean(publicKey),
            fcmEnabled,
            publicKey
        })
    );
});

export const subscribePush = asyncHandler(async (req, res) => {
    await savePushSubscription(req.user._id, req.body);
    res.status(201).json(new ApiResponse(201, { subscribed: true }));
});

export const unsubscribePush = asyncHandler(async (req, res) => {
    const target =
        req.body?.endpoint || req.body?.token || req.body?.fcmToken || "";
    if (typeof target !== "string" || !target.trim()) {
        return res
            .status(400)
            .json(
                new ApiResponse(400, {}, "A valid endpoint or token is required")
            );
    }
    await removePushSubscription(req.user._id, target);
    res.status(200).json(new ApiResponse(200, { unsubscribed: true }));
});
