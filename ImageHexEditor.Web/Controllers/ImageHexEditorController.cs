using Microsoft.AspNetCore.Mvc;

namespace ImageHexEditor.Web.Controllers;

/// <summary>
/// Controller for the Image Hex Editor landing page.
/// </summary>
public class ImageHexEditorController : Controller
{
    /// <summary>
    /// Display the Image Hex Editor landing page.
    /// </summary>
    [HttpGet("/imagehexeditor")]
    public IActionResult Index()
    {
        ViewData["Title"] = "Image Hex Editor";
        ViewData["IsAppPage"] = true;

        // Explicit feature-folder view path so this module stays portable.
        return View("~/Apps/ImageHexEditor/Views/Index.cshtml");
    }
}
