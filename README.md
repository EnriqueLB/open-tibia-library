# Open Tibia Library

A powerful TypeScript library for manipulating core Open Tibia files (`.dat`, `.spr`, `.otb`). This library serves as a foundation for building tools like Map Editors, Item Editors, and automated asset generators.

## 🚀 What can you do with this project?

This project provides a wide range of tools for working with Tibia client files and generating resources for servers or third-party tools.

### 1. Image and Animation Generation

- **Item Image Generator**: Generate individual images or sprite sheets for items.
- **Outfit Image Generator**: Create outfit images with support for different directions and animation states.
- **Effect & Missile Generators**: Generate animation frames for magic effects and projectiles.
- **GIF Conversion**: Integrated tools to convert image sequences into animated GIFs (useful for wikis or web previews).

### 2. Artificial Intelligence Tools (YOLO)

- **YOLO Annotation Generator**: Automatically create datasets for training YOLO detection and segmentation models by extracting sprites and generating their segmentation masks.

### 3. Specialized Tools

- **OTB Editor**: A functional example of how to programmatically edit `items.otb` files (e.g., filtering items by ID).
- **PHP Tools**: Includes PHP utilities for dynamic outfit coloring and image cache management.

---

## 🛠️ Installation and Usage

### Prerequisites

- [Node.js](https://nodejs.org/) installed on your system.

### Environment Setup

1. Clone or download this repository.

2. Open a terminal in the project folder.

3. Install dependencies:
   
   ```bash
   npm install
   ```

4. Build the project:
   
   ```bash
   npm run build
   ```

### How to run the generators

Once the project is built (files will appear in the `js/` folder), you can open the `.html` files directly in your web browser (Chrome recommended):

- `itemImageGenerator.html`: Item image generator.
- `outfitImageGenerator.html`: Outfit image generator.
- `otbEditor.html`: Basic OTB file editor.
- `yoloSegAnnotationGenerator.html`: AI training data generator.

## 📚 Project Structure

- `modules/`: Main source code (File logic, binary handlers, structures).
- `tools/`: Additional PHP utilities and conversion scripts.
- `output/`: Default folder for generated files.

---

## This is a fork, Credits to creator!
