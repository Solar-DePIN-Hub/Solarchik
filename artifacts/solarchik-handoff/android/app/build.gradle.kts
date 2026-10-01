import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
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
        versionCode = 63
        versionName = "0.20.3"
        buildConfigField("boolean", "MAINNET_PAID_MINT", "false")
    }

    buildFeatures { buildConfig = true }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            it.maxHeapSize = "1536m"
            it.systemProperty("solarchik.devnet", (project.findProperty("devnet") as String?) ?: "0")
            it.systemProperty("solarchik.live", (project.findProperty("live") as String?) ?: "")
            it.systemProperty("solarchik.chat", (project.findProperty("chat") as String?) ?: "")
            it.systemProperty("solarchik.shots", (project.findProperty("shots") as String?) ?: layout.buildDirectory.dir("screens").get().asFile.path)
        }
    }

    signingConfigs {
        // Release key lives only on the build box (gitignored). Debug builds use the standard debug key.
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
            // Unsigned release when the box keystore is absent (e.g. a fresh clone).
            signingConfig = if (file("solarchik-release.jks").exists()) signingConfigs.getByName("release") else null
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isDebuggable = true
            signingConfig = signingConfigs.getByName("debug")
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
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.solanamobile:mobile-wallet-adapter-clientlib-ktx:2.0.7")
    implementation("org.sol4k:sol4k:0.5.14")
    implementation("io.github.funkatronics:kborsh:0.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("androidx.work:work-runtime-ktx:2.10.5")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
