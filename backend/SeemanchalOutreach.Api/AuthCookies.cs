namespace SeemanchalOutreach.Api
{
    /// <summary>
    /// Cookie names shared between Program.cs (reads the access-token cookie for
    /// every authenticated request) and AuthController (sets/clears both cookies
    /// on login/refresh/logout). Kept in one place so the two never drift.
    /// </summary>
    public static class AuthCookies
    {
        public const string AccessToken = "nx_at";
        public const string RefreshToken = "nx_rt";
    }
}
