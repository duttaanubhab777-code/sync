// req.body কে zod schema অনুযায়ী যাচাই করে। ভুল হলে প্রথম error message ফেরত দেয়।
// (zod v4-এ error-এর তালিকা থাকে err.issues-এ, আগের err.errors আর নেই)
export const validate = schema => async (req, res, next) => {
    try {
        req.body = await schema.parseAsync(req.body ?? {});
        next();
    } catch (err) {
        const message = err?.issues?.[0]?.message || "Invalid request data";
        return res
            .status(400)
            .json({ success: false, statusCode: 400, message, errors: [] });
    }
};
