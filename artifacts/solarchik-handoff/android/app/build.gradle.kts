import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val keystoreProperties = Properties().apply {
    val secrets = file("keystore.properties")
    if (secrets.exists()) secrets.inputStream().use { load(it) }
}

fun keystoreSecret(envName: String, propName: String): String =
    System.getenv(envName) ?: keystoreProperties.getProperty(propName).orEmpty()

android {
    namespace = "net.solardepin.solarchik"
    compileSdk = 35
    layout.buildDirectory.set(file("/tmp/solarchik-apk-build"))

    defaultConfig {
        applicationId = "net.solardepin.solarchik"
        minSdk = 26
        targetSdk = 35
        versionCode = 51
        versionName = "0.19.51"
    }

    signingConfigs {
        create("release") {
            storeFile = file("solarchik-release.jks")
            storePassword = keystoreSecret("SOLARCHIK_STORE_PASSWORD", "storePassword")
            keyAlias = "solarchik"
            keyPassword = keystoreSecret("SOLARCHIK_KEY_PASSWORD", "keyPassword")
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            isDebuggable = false
            isJniDebuggable = false
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isDebuggable = true
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
        resources {
            excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/*.kotlin_module")
        }
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.solanamobile:mobile-wallet-adapter-clientlib-ktx:2.0.7")
}
