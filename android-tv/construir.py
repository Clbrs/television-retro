"""Construye y firma el APK de Televisión Retro para Android TV sin Gradle.

Uso (en Windows):  python construir.py <carpeta_sdk> <carpeta_claves> [version]
- <carpeta_sdk>: SDK de Android con build-tools;35.0.0 y platforms;android-35
- <carpeta_claves>: donde vive (o se crea) el almacén de firma. Fuera del repositorio.
Deja el APK firmado en ./salida/television-retro.apk
"""
import os
import secrets
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

AQUI = Path(__file__).resolve().parent
SDK = Path(sys.argv[1]).resolve()
CLAVES = Path(sys.argv[2]).resolve()
VERSION = int(sys.argv[3]) if len(sys.argv) > 3 else 1

BT = SDK / "build-tools" / "35.0.0"
ANDROID_JAR = SDK / "platforms" / "android-35" / "android.jar"
JAVA_HOME = Path(os.environ["JAVA_HOME"])
WIN = os.name == "nt"
EXE = ".exe" if WIN else ""
BAT = ".bat" if WIN else ""

TMP = AQUI / "obj"
SALIDA = AQUI / "salida"


def correr(*args):
    print(">", Path(str(args[0])).name, *[a for a in map(str, args[1:]) if "pass" not in a])
    subprocess.run([str(a) for a in args], check=True)


def almacen():
    """Almacén de firma propio: se crea una vez, con contraseña aleatoria guardada en un fichero."""
    CLAVES.mkdir(parents=True, exist_ok=True)
    ks = CLAVES / "television-retro.jks"
    pw = CLAVES / "television-retro.pass"
    if not ks.exists():
        pw.write_text(secrets.token_urlsafe(32), encoding="ascii")
        correr(JAVA_HOME / "bin" / f"keytool{EXE}", "-genkeypair", "-keystore", ks, "-storetype", "PKCS12",
               "-alias", "tvretro", "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
               "-dname", "CN=Television Retro", f"-storepass:file", pw)
    return ks, pw


def main():
    shutil.rmtree(TMP, ignore_errors=True)
    (TMP / "clases").mkdir(parents=True)
    (TMP / "dex").mkdir()
    SALIDA.mkdir(exist_ok=True)

    correr(BT / f"aapt2{EXE}", "compile", "--dir", AQUI / "res", "-o", TMP / "res.zip")
    correr(BT / f"aapt2{EXE}", "link", "-o", TMP / "base.apk", "-I", ANDROID_JAR,
           "--manifest", AQUI / "AndroidManifest.xml", "--min-sdk-version", "28", "--target-sdk-version", "34",
           "--version-code", VERSION, "--version-name", f"1.{VERSION}", TMP / "res.zip")

    fuentes = sorted((AQUI / "src").rglob("*.java"))
    correr(JAVA_HOME / "bin" / f"javac{EXE}", "-Xlint:-options", "-source", "11", "-target", "11",
           "-encoding", "UTF-8", "-classpath", ANDROID_JAR, "-d", TMP / "clases", *fuentes)
    clases = sorted((TMP / "clases").rglob("*.class"))
    correr(BT / f"d8{BAT}", "--release", "--min-api", "28", "--lib", ANDROID_JAR, "--output", TMP / "dex", *clases)

    # Mete classes.dex respetando cómo guardó aapt2 cada entrada (resources.arsc sin comprimir).
    sin_alinear = TMP / "sin_alinear.apk"
    with zipfile.ZipFile(TMP / "base.apk") as z, zipfile.ZipFile(sin_alinear, "w") as n:
        for e in z.infolist():
            n.writestr(e, z.read(e), compress_type=e.compress_type)
        n.write(TMP / "dex" / "classes.dex", "classes.dex", compress_type=zipfile.ZIP_DEFLATED)

    alineado = TMP / "alineado.apk"
    correr(BT / f"zipalign{EXE}", "-p", "-f", "4", sin_alinear, alineado)

    ks, pw = almacen()
    final = SALIDA / "television-retro.apk"
    correr(BT / f"apksigner{BAT}", "sign", "--ks", ks, "--ks-key-alias", "tvretro",
           "--ks-pass", f"file:{pw}", "--out", final, alineado)
    correr(BT / f"apksigner{BAT}", "verify", "--verbose", final)
    print("APK:", final)


if __name__ == "__main__":
    main()
