import jwt from "jsonwebtoken";

const isProd = () =>
    process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);

const baseOptions = () => ({
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax"
});

// cookie-র মেয়াদ token-এর exp থেকেই নেওয়া হয়
const maxAgeOf = token => {
    const exp = jwt.decode(token)?.exp;
    return exp ? Math.max(exp * 1000 - Date.now(), 0) : undefined;
};

export const setAuthCookies = (res, { accessToken, refreshToken }) => {
    res.cookie("accessToken", accessToken, {
        ...baseOptions(),
        path: "/",
        maxAge: maxAgeOf(accessToken)
    });
    // refresh token শুধু /api/auth পথে ব্রাউজার পাঠাবে
    if (refreshToken) {
        res.cookie("refreshToken", refreshToken, {
            ...baseOptions(),
            path: "/api/auth",
            maxAge: maxAgeOf(refreshToken)
        });
    }
};

export const clearAuthCookies = res => {
    res.clearCookie("accessToken", { ...baseOptions(), path: "/" });
    res.clearCookie("refreshToken", { ...baseOptions(), path: "/api/auth" });
};
