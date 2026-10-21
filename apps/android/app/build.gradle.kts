import java.util.Properties

plugins {
    id("com.android.application")
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

// -Pstore=true builds the store edition for Google Play and the Amazon Appstore (see Edition.kt). Without it the
// build is the lumanest.tv download, exactly as before. Both editions share the application ID, version and key.
val storeBuild = when (val value = providers.gradleProperty("store").orNull?.trim()?.lowercase()) {
    null, "", "false" -> false
    "true" -> true
    else -> error("Use -Pstore=true for the Google Play / Amazon Appstore build, or leave it out for the lumanest.tv APK (got \"$value\")")
}
// Google Play gets only the store edition: the lumanest.tv edition can unlock adult categories. Checked on the task
// graph before anything is built. Every task that writes a release App Bundle (bundleRelease, bundle,
// signReleaseBundle, abbreviations...) runs packageReleaseBundle; assembleRelease, tests and lint never do.
if (!storeBuild) {
    val releaseBundle = "$path:packageReleaseBundle"
    gradle.taskGraph.whenReady {
        if (hasTask(releaseBundle)) throw GradleException("Google Play needs the store edition. Run: .\\gradlew.bat bundleRelease -Pstore=true")
    }
}
// Store files get their own names (app-store-release.aab / .apk), so they can't be mistaken for the lumanest.tv APK.
if (storeBuild) base.archivesName.set("app-store")

android {
    namespace = "tv.lumanest.tuner"
    compileSdk = 37

    defaultConfig {
        // The store edition is its own app on Google Play and the Amazon Appstore (package app.tunertv, after
        // tunertv.app); the lumanest.tv APK keeps tv.lumanest.tuner. Different packages never update each other, so a
        // store release can't replace a lumanest.tv install (or the reverse), and the two can sit side by side.
        applicationId = if (storeBuild) "app.tunertv" else "tv.lumanest.tuner"
        minSdk = 23
        targetSdk = 35
        versionCode = 22
        versionName = "1.8.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("boolean", "STORE_BUILD", storeBuild.toString())
        // Store edition: Android TV only on Google Play, and no picture-in-picture (Play's TV rules allow it only for
        // calls and similar apps, never automatically for video). The lumanest.tv APK keeps both as before.
        manifestPlaceholders["leanbackRequired"] = storeBuild.toString()
        manifestPlaceholders["pictureInPicture"] = (!storeBuild).toString()
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
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    val media3 = "1.11.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.media3:media3-datasource-okhttp:$media3")

    implementation("com.squareup.okhttp3:okhttp:5.5.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.coil-kt:coil-svg:2.7.0")
    implementation("com.google.zxing:core:3.5.4")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
