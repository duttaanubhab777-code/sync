export const validate = schema => async (req, res, next) => {
    try {
        // req.body কে স্কিমা অনুযায়ী ভ্যালিডেট করবে
        const parseBody = await schema.parseAsync(req.body);
        req.body = parseBody;
        next();
    } catch (err) {
        // ভ্যালিডেশন ফেইল করলে ফ্রন্টএন্ডে এরর পাঠাবে
        const message = err.errors[0].message;
        return res.status(400).json({ message: message });
    }
};
