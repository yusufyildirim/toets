plugins {
    id("com.android.application")
}

android {
    namespace = "tv.dpad.fixture"
    compileSdk = 36

    defaultConfig {
        applicationId = "tv.dpad.fixture"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
