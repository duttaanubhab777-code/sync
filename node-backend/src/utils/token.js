// JWT secret ও মেয়াদ এক জায়গায় রাখা হলো, যাতে model, middleware আর socket সবাই একই মান ব্যবহার করে।
// Python সার্ভিসও যেন একই secret দিয়ে token যাচাই করতে পারে, তাই .env-এ JWT_SECRET রাখাই ভালো।
// পুরনো ACCESS_TOKEN_SECRET নামটাও কাজ করবে।

export const getAccessSecret = () => {
    const secret = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not set in .env");
    return secret;
};

export const getRefreshSecret = () =>
    process.env.REFRESH_TOKEN_SECRET || getAccessSecret();

export const getAccessExpiry = () =>
    process.env.JWT_EXPIRES_IN || process.env.ACCESS_TOKEN_EXPIRY || "7d";
