import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Explicit private signing locations override the ignored repository-root directory.
val releasePropertiesFile = providers.gradleProperty("tunerSigningProperties").orNull?.takeIf { it.isNotBlank() }?.let { file(it) }
    ?: System.getenv("TUNER_SIGNING_DIR")?.takeIf { it.isNotBlank() }?.let { file("$it/keystore.properties") }
    ?: rootProject.file("../../signing/android/keystore.properties")
val releaseProperties = Properties().apply {
    if (releasePropertiesFile.isFile) releasePropertiesFile.inputStream().use { load(it) }
}
val testJavaExecutable = providers.gradleProperty("tunerTestJavaExecutable").orNull
fun signingValue(name: String): String = releaseProperties.getProperty(name)?.takeIf { it.isNotBlank() }
    ?: error("Missing $name in the external release signing properties")

android {
    namespace = "tv.lumanest.tuner"
    compileSdk = 35

    defaultConfig {
        applicationId = "tv.lumanest.tuner"
        minSdk = 23
        targetSdk = 35
        versionCode = 15
        versionName = "1.6.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (releasePropertiesFile.isFile) create("release") {
            val configuredStore = File(signingValue("storeFile"))
            storeFile = if (configuredStore.isAbsolute) configuredStore
                else releasePropertiesFile.parentFile.resolve(configuredStore.path)
            require(storeFile!!.isFile) { "The external release keystore does not exist" }
            storePassword = signingValue("storePassword")
            keyAlias = signingValue("keyAlias")
            keyPassword = signingValue("keyPassword")
        }
    }
    buildTypes {
        debug { signingConfig = signingConfigs.getByName("debug") }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Without the shared key, produce an unsigned release instead of inventing a new key.
            signingConfig = signingConfigs.findByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            // Windows ARM can run Gradle natively and only emulate the x64 Robolectric JVM.
            testJavaExecutable?.let { executable -> it.executable = executable }
            it.systemProperty("robolectric.dependency.repo.url", System.getenv("MAVEN_MIRROR") ?: "https://repo1.maven.org/maven2")
            it.maxHeapSize = "3g"
            // Conscrypt ships no Windows-on-ARM native library; the tests don't need it.
            it.systemProperty("robolectric.conscryptMode", "OFF")
            System.getenv("FREE_EPG")?.let { f -> it.systemProperty("free.epg", f) }
            // -PtunerRealData=<folder of provider JSON> runs RealDataProbe against a real catalogue.
            providers.gradleProperty("tunerRealData").orNull?.let { f -> it.systemProperty("tuner.realData", f) }
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    val media3 = "1.5.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.media3:media3-datasource-okhttp:$media3")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.coil-kt:coil-svg:2.7.0")
    implementation("com.google.zxing:core:3.5.3")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
