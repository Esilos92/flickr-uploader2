module.exports = (req, res) => {
  // Check if Flickr env vars exist
  const envVars = {
    FLICKR_API_KEY: !!process.env.FLICKR_API_KEY,
    FLICKR_API_SECRET: !!process.env.FLICKR_API_SECRET,
    FLICKR_ACCESS_TOKEN: !!process.env.FLICKR_ACCESS_TOKEN,
    FLICKR_ACCESS_SECRET: !!process.env.FLICKR_ACCESS_SECRET,
    FLICKR_USER_ID: !!process.env.FLICKR_USER_ID,
  };

  const allSet = Object.values(envVars).every(v => v);

  res.status(200).json({
    message: 'Environment check',
    envVarsSet: envVars,
    allConfigured: allSet,
    timestamp: new Date().toISOString()
  });
};
