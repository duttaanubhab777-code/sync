// ইমেইল থেকে username বানানো: "Jarvis.Dev+news@gmail.com" -> "jarvis_dev"
// নিয়ম (backend-এর সাথে এক): ৩–২০ অক্ষর, ইংরেজি ছোট হাতের অক্ষর দিয়ে শুরু, শুধু a-z 0-9 _
export const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

export const usernameFromEmail = email => {
    const local = String(email || "")
        .trim()
        .toLowerCase()
        .split("@")[0]
        .split("+")[0]; // gmail-এর +tag বাদ

    let name = local
        .replace(/[^a-z0-9_]+/g, "_") // . - ইত্যাদি -> _
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");

    if (!name) return "";
    if (!/^[a-z]/.test(name)) name = `user_${name}`; // সংখ্যা দিয়ে শুরু হলে
    name = name.slice(0, 20).replace(/_+$/g, "");
    if (name.length < 3) name = `${name}_user`.slice(0, 20); // খুব ছোট হলে
    return name;
};
