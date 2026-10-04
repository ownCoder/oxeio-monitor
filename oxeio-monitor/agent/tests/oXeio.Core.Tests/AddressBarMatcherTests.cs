using oXeio.Core.Apps;

namespace oXeio.Core.Tests;

/// <summary>
/// Which Edit is the address bar. The first rule — identifiers that are the
/// same in every UI language — is what makes domains work on a browser that
/// is not in English; the rest is the behaviour from before, unchanged.
/// </summary>
public class AddressBarMatcherTests
{
    private sealed record Edit(string? Name = null, string? Id = null, string? Class = null);

    private static int? Pick(params Edit[] edits) => Pick(null, edits);

    private static int? Pick(IReadOnlyCollection<string>? extra, params Edit[] edits) =>
        AddressBarMatcher.Pick(
            edits.Length,
            i => edits[i].Class,
            i => edits[i].Id,
            i => edits[i].Name,
            extra);

    [Fact]
    public void No_edits_no_answer() => Assert.Null(Pick());

    [Theory]
    [InlineData("Barra de endereço e de pesquisa")] // Chrome, Portuguese
    [InlineData("Adress- und Suchleiste")]          // Chrome, German
    [InlineData("アドレス検索バー")]                 // Chrome, Japanese
    public void Chromium_omnibox_is_found_by_class_in_any_language(string name)
    {
        var picked = Pick(
            new Edit("Pesquisar", Class: "Textfield"), // a find box before it
            new Edit(name, Class: "OmniboxViewViews"));

        Assert.Equal(1, picked);
    }

    [Fact]
    public void Firefox_url_bar_is_found_by_automation_id_in_any_language()
    {
        var picked = Pick(
            new Edit("Buscar"),
            new Edit("Pesquise ou digite um endereço", Id: "urlbar-input"));

        Assert.Equal(1, picked);
    }

    [Fact]
    public void The_language_neutral_rule_wins_over_an_English_name()
    {
        // a page field labelled "address bar" must not beat the real omnibox
        var picked = Pick(
            new Edit("Address bar demo"),
            new Edit("whatever", Class: "OmniboxViewViews"));

        Assert.Equal(1, picked);
    }

    [Theory]
    [InlineData("Address and search bar")]
    [InlineData("Search or enter address")]
    public void English_names_still_work_as_before(string name)
    {
        Assert.Equal(1, Pick(new Edit("Search this page"), new Edit(name)));
    }

    [Fact]
    public void Extra_names_from_the_caller_are_accepted()
    {
        var picked = Pick(["Barra de endereço"], new Edit("Buscar"), new Edit("Barra de endereço"));

        Assert.Equal(1, picked);
    }

    [Fact]
    public void Nothing_recognised_falls_back_to_the_first_edit_as_before()
    {
        Assert.Equal(0, Pick(new Edit("Barra de endereço"), new Edit("Buscar")));
    }

    [Fact]
    public void Stops_at_the_first_match_without_reading_the_rest()
    {
        var reads = 0;
        var picked = AddressBarMatcher.Pick(
            50,
            i => { reads++; return i == 0 ? "OmniboxViewViews" : null; },
            _ => { reads++; return null; },
            _ => { reads++; return null; });

        Assert.Equal(0, picked);
        Assert.Equal(1, reads);
    }
}
